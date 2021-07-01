import { green, yellow } from 'kleur';
import { exit } from '../util/exit';
import { prompt } from '../util/prompt';
import { exec, execSyncInherit } from '../util/shell';
import { writeConfig, readServiceYaml } from './utils';
import { checkTerraformCommand, terraformInit, terraformApply } from './provision/index';
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

  for (let ingress of ingresses) {
    console.info(yellow(`=> Configure ${ingress} ingress`));
    let ip = await configureIngress(ingress);
    ips.push([ingress + '-ingress', ip]);

    console.info(yellow(`=> Creating ${ingress} ingress`));
    await execSyncInherit(`kubectl delete -f ${envPath}/services/${ingress}-ingress.yml --ignore-not-found`);
    await execSyncInherit(`kubectl create -f ${envPath}/services/${ingress}-ingress.yml`);
  }

  await rollout({ environment, service: 'cli' });
  await rollout({ environment, service: 'api' });
  await rollout({ environment, service: 'elasticsearch-sink' });
  await rollout({ environment, service: 'web' });

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
