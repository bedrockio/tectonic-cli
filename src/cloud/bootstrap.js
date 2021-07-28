import { green, yellow } from 'kleur';
import { exit } from '../util/exit';
import { prompt } from '../util/prompt';
import { exec, execSyncInherit } from '../util/shell';
import { sleep } from '../util/sleep';
import { writeConfig, readServiceYaml } from './utils';
import { checkTerraformCommand, terraformInit, terraformApply, terraformRefresh } from './provision/index';
import { authorize, status, rollout } from './index';

export async function bootstrapProjectEnvironment(project, environment, config) {
  await checkTerraformCommand();

  let activeAccount = '';
  try {
    activeAccount = await exec('gcloud config get-value account');
    if (!activeAccount) throw new Error('No activeAccount');
  } catch (e) {
    exit('There is no active gcloud account. Please login to glcloud first. Run: "tectonic cloud login"');
  }

  try {
    await exec(`gcloud projects describe ${project} --format json`);
  } catch (e) {
    exit(
      `Error: No access for user [${activeAccount}] or unknown project [${project}]
       (Perhaps you need to login first: "tectonic cloud login")`
    );
  }

  console.info(green(`Verified Google Cloud project [${project}] for environment [${environment}]`));

  const { gcloud } = config;
  if (!gcloud) exit(`Missing gcloud in config.json for environment [${environment}]`);
  if (!gcloud.project) exit(`Missing gcloud.project in config.json for environment [${environment}]`);
  if (project != gcloud.project) {
    let confirmed = await prompt({
      type: 'confirm',
      name: 'open',
      message: `Project [${project}] is different from project [${gcloud.project}] as defined in config.json. Your config.json will be updated, do you want to continue?`,
      initial: true,
    });
    if (!confirmed) process.exit(0);
    const updatedConfig = { ...config };
    if (config.gcloud.bucketPrefix == config.gcloud.project) {
      updatedConfig.gcloud.bucketPrefix = project;
    }
    updatedConfig.gcloud.project = project;
    writeConfig(environment, updatedConfig);
  }

  console.info(yellow('=> Updating gcloud config project'));
  await execSyncInherit(`gcloud config set project ${project}`);
  console.info(yellow('=> Enabling Compute services (This can take a couple of minutes)'));
  await execSyncInherit('gcloud services enable compute.googleapis.com');
  console.info(yellow('=> Enabling Kubernetes services'));
  await execSyncInherit('gcloud services enable container.googleapis.com');

  console.info(yellow('=> Terraform init'));
  await terraformInit({ environment });
  console.info(yellow('=> Terraform apply'));
  await terraformApply({ environment });
  console.info(yellow('=> Terraform refresh'));
  await terraformRefresh({ environment });

  console.info(yellow('=> Authorizing into Kubernetes cluster'));
  await authorize({ environment });
  console.info(yellow('=> Get Kubernetes cluster nodes'));
  await execSyncInherit('kubectl get nodes');

  const envPath = `environments/${environment}`;
  const ingresses = gcloud.ingresses || [];

  console.info(yellow('=> Creating data pods'));
  await execSyncInherit(`kubectl delete -f ${envPath}/data --ignore-not-found`);
  await execSyncInherit(`kubectl create -f ${envPath}/data`);

  const ips = [];

  const ingressJSON = await exec(`kubectl get ingress -o json --ignore-not-found`);
  let existingIngresses = [];
  if (ingressJSON) {
    const ingressItems = JSON.parse(ingressJSON).items;
    existingIngresses = ingressItems.map((pod) => pod.metadata.name);
  }

  for (let ingress of ingresses) {
    console.info(yellow(`=> Configure ${ingress} ingress`));
    let ip = await configureIngress(ingress);
    ips.push([ingress + '-ingress', ip]);

    // TODO prompt user for recreation?
    if (existingIngresses.includes(`${ingress}-ingress`)) {
      console.info(yellow(`=> '${ingress}-ingress' already exists`));
    } else {
      console.info(yellow(`=> Creating ${ingress} ingress`));
      await execSyncInherit(`kubectl delete -f ${envPath}/services/${ingress}-ingress.yml --ignore-not-found`);
      await execSyncInherit(`kubectl create -f ${envPath}/services/${ingress}-ingress.yml`);
    }
  }

  console.info(yellow(`=> Waiting for data services and ingress to be ready (20 seconds)`));
  await sleep(20 * 1000);

  console.info(yellow('=> Creating service pods'));
  await execSyncInherit(`kubectl delete -f ${envPath}/services/cli-deployment.yml --ignore-not-found`);
  await execSyncInherit(`kubectl create -f ${envPath}/services/cli-deployment.yml`);

  await execSyncInherit(`kubectl delete -f ${envPath}/services/api-deployment.yml --ignore-not-found`);
  await execSyncInherit(`kubectl create -f ${envPath}/services/api-deployment.yml`);

  await execSyncInherit(`kubectl delete -f ${envPath}/services/elasticsearch-sink-deployment.yml --ignore-not-found`);
  await execSyncInherit(`kubectl create -f ${envPath}/services/elasticsearch-sink-deployment.yml`);

  await execSyncInherit(`kubectl delete -f ${envPath}/services/web-deployment.yml --ignore-not-found`);
  await execSyncInherit(`kubectl create -f ${envPath}/services/web-deployment.yml`);

  await status({ environment });

  if (ips.length) {
    console.info(yellow('=> Finishing up'));
    console.info(green('Make sure to configure your DNS records (Cloudflare recommended)\n'));
  }
  for (const [serviceName, serviceIP] of ips) {
    console.info(green(` ${serviceName}:`));
    console.info(green(` - address: ${serviceIP}`));
    if (serviceName == 'api' || serviceName.match(/api-ingress$/)) {
      try {
        const apiUrl = getApiUrl(environment);
        if (apiUrl) {
          console.info(green(` - configuration of API_URL in web deployment: ${apiUrl}\n`));
        }
      } catch (e) {
        // Ignore error
      }
    }
    if (serviceName == 'web' || serviceName.match(/web-ingress$/)) {
      try {
        const appUrl = getAppUrl(environment);
        if (appUrl) {
          console.info(green(` - configuration of APP_URL in api deployment: ${appUrl}\n`));
        }
      } catch (e) {
        // Ignore error
      }
    }
  }

  console.info(green('Done!'));
}

async function configureIngress(ingress) {
  let addressIP;
  const ingressName = ingress + '-ingress';
  try {
    const addressJSON = await exec(`gcloud compute addresses describe --global ${ingressName} --format json`);
    addressIP = JSON.parse(addressJSON).address;
  } catch (e) {
    console.info(yellow(`Creating ${ingressName.toUpperCase()} address`));
    await execSyncInherit(`gcloud compute addresses create ${ingressName} --global`);
    const addressJSON = await exec(`gcloud compute addresses describe --global ${ingressName} --format json`);
    addressIP = JSON.parse(addressJSON).address;
  }
  console.info(green(`${ingressName.toUpperCase()} ingress addressIP: ${addressIP}`));
  return addressIP;
}

function getAppUrl(environment) {
  const fileName = 'api-deployment.yml';
  const serviceYaml = readServiceYaml(environment, fileName);
  return serviceYaml.spec.template.spec.containers[0].env
    .filter((env) => {
      return env.name == 'APP_URL';
    })
    .filter(Boolean)[0].value;
}

function getApiUrl(environment) {
  const fileName = 'web-deployment.yml';
  const serviceYaml = readServiceYaml(environment, fileName);
  return serviceYaml.spec.template.spec.containers[0].env
    .filter((env) => {
      return env.name == 'API_URL';
    })
    .filter(Boolean)[0].value;
}
