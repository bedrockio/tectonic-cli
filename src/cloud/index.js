import open from 'open';
import { reset, gray, green, yellow, red } from 'kleur';
import { assertTectonicRoot } from '../util/dir';
import { exec, execSyncInherit } from '../util/shell';
import { prompt } from '../util/prompt';
import { setGCloudConfig, checkConfig } from './authorize';
import { rolloutDeployment, getDeployment, deleteDeployment, checkDeployment } from './rollout';
import { readConfig, checkKubectlVersion, getEnvironmentPrompt, getServicesPrompt } from './utils';
import { bootstrapProjectEnvironment } from './bootstrap';

export async function authorize(options) {
  await assertTectonicRoot();

  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await setGCloudConfig(config.gcloud);
}

export async function account(options) {
  try {
    const auth = JSON.parse(await exec('gcloud auth list --format json'));

    const name =
      options.name ||
      (await prompt({
        message: 'Select Account',
        type: 'select',
        choices: auth.map(({ account, status }) => {
          const active = status === 'ACTIVE' ? ' (active)' : '';
          return {
            title: `${account}${reset(gray(active))}`,
            value: account,
          };
        }),
      }));

    const active = auth.find(({ status }) => {
      return status === 'ACTIVE';
    });
    if (!active || active.account !== name) {
      await execSyncInherit(`gcloud config set account ${name}`);
      console.info(yellow(`=> Activate account "${name}"`));
    } else {
      console.info(yellow('No changes'));
    }
  } catch (e) {
    console.info(red('Could not get accounts from "gcloud config configuration list"'));
    return;
  }
}

export async function login() {
  console.info(yellow('This will open a gcloud login URL in your browser for your account auth.'));
  let confirmed = await prompt({
    type: 'confirm',
    name: 'open',
    message: 'Would you like to proceeed?',
    initial: true,
  });
  if (!confirmed) return;
  console.info(yellow('=> Opening browser to auth login'));
  await execSyncInherit('gcloud auth login');
}

export async function loginApplication() {
  console.info(yellow('This will open a gcloud login URL in your browser for your application default.'));
  let confirmed = await prompt({
    type: 'confirm',
    name: 'open',
    message: 'Would you like to proceeed?',
    initial: true,
  });
  if (!confirmed) return;
  console.info(yellow('=> Opening browser to auth application-default login'));
  await execSyncInherit('gcloud auth application-default login');
}

export async function status(options) {
  await assertTectonicRoot();
  await checkKubectlVersion();

  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await checkConfig(environment, config);

  await execSyncInherit('kubectl get ingress');
  console.info('');
  await execSyncInherit('kubectl get services');
  console.info('');
  await execSyncInherit('kubectl get nodes');
  console.info('');
  await execSyncInherit('kubectl get hpa');
  console.info('');
  const podInfo = await exec('kubectl get pods');
  console.info(podInfo, '\n');
  if (podInfo.includes('CreateContainerConfigError')) {
    console.info(
      yellow(
        `CreateContainerConfigError: Check if you created the required secrets, e.g., "bedrock cloud secret ${environment} set credentials"`
      )
    );
  }
}

export async function rollout(options) {
  await assertTectonicRoot();
  await checkKubectlVersion();

  const { service, subservice } = options;
  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await checkConfig(environment, config);

  if (!service) {
    const services = await getServicesPrompt(environment);
    if (!services.length) {
      console.info(yellow('There were no services selected'));
      process.exit(0);
    }
    for (const [service, subservice] of services) {
      await rolloutDeployment(environment, service, subservice);
    }
  } else {
    await rolloutDeployment(environment, service, subservice);
  }
}

export async function remove(options) {
  await assertTectonicRoot();

  const { service, subservice } = options;
  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await checkConfig(environment, config);

  if (!service) {
    const services = await getServicesPrompt(environment);
    if (!services.length) {
      console.info(yellow('There were no services selected'));
      process.exit(0);
    }
    for (const [service, subservice] of services) {
      const exists = await checkDeployment(service, subservice);
      if (exists) await deleteDeployment(environment, service, subservice);
    }
  } else {
    const exists = await checkDeployment(service, subservice);
    if (exists) await deleteDeployment(environment, service, subservice);
  }
}

async function showDeploymentInfo(service, subservice) {
  const deployment = getDeployment(service, subservice);
  const deploymentInfo = await checkDeployment(service, subservice);
  if (deploymentInfo) {
    const { annotations } = deploymentInfo.spec.template.metadata;
    console.info(green(`Deployment "${deployment}" annotations:`));
    console.info(annotations);
  }
}

export async function info(options) {
  await assertTectonicRoot();
  await checkKubectlVersion();

  const { service, subservice } = options;
  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await checkConfig(environment, config);

  if (!service) {
    const services = await getServicesPrompt(environment);
    if (!services.length) {
      console.info(yellow('There were no services selected'));
      process.exit(0);
    }
    for (const [service, subservice] of services) {
      await showDeploymentInfo(service, subservice);
    }
  } else {
    await showDeploymentInfo(service, subservice);
  }
}

export async function shell(options) {
  await assertTectonicRoot();

  const { service, subservice } = options;
  const environment = options.environment || (await getEnvironmentPrompt());
  await checkKubectlVersion();
  const config = readConfig(environment);
  await checkConfig(environment, config);

  const podsJSON = await exec(`kubectl get pods -o json --ignore-not-found`);
  if (!podsJSON) {
    console.info(yellow(`No running pods`));
    process.exit(0);
  }
  const pods = JSON.parse(podsJSON).items;

  let deployment = 'cli-deployment';
  if (service) {
    deployment = getDeployment(service, subservice);
  }

  const filteredPods = pods.filter((pod) => pod.metadata.name.startsWith(deployment));

  if (!filteredPods.length) {
    console.info(yellow(`No running pods for deployment "${deployment}"`));
    process.exit(0);
  }

  const podName = filteredPods[0].metadata.name;
  console.info(yellow(`=> Starting bash for pod: "${podName}"`));

  const { spawn } = require('child_process');

  const child = spawn('kubectl', ['exec', '-it', podName, '--', 'bash'], {
    stdio: 'inherit',
  });

  child.on('exit', function (code) {
    console.info(green(`Finished bash for pod: "${podName}" (exit code: ${code})`));
  });
}

export async function portForward(options) {
  await assertTectonicRoot();

  const environment = options.environment || (await getEnvironmentPrompt());
  await checkKubectlVersion();
  const config = readConfig(environment);
  await checkConfig(environment, config);

  let service = options.service;
  let subservice = options.subservice;
  if (!service) {
    [service, subservice] = await getServicesPrompt(environment, 'select');
  }

  let deployment = `deployment/${service}`;
  if (subservice) {
    deployment += `-${subservice}`;
  }
  deployment += '-deployment';

  const localPort =
    options.localPort ||
    (await prompt({
      type: 'text',
      message: 'Enter Local Port number',
      initial: '5602',
      validate: (value) => (!value.match(/^[0-9]+$/gim) ? `Port may contain only numbers.` : true),
    }));

  const remotePort =
    options.remotePort ||
    (await prompt({
      type: 'text',
      message: 'Enter Remote Port number',
      initial: '5601',
      validate: (value) => (!value.match(/^[0-9]+$/gim) ? `Port may contain only numbers.` : true),
    }));

  console.info(yellow(`=> Starting portFoward for "${deployment}" ${localPort}:${remotePort}`));

  await execSyncInherit(`kubectl port-forward ${deployment} ${localPort}:${remotePort}`);
}

export async function kibana(options) {
  await assertTectonicRoot();

  const environment = options.environment || (await getEnvironmentPrompt());
  await checkKubectlVersion();
  const config = readConfig(environment);
  await checkConfig(environment, config);

  let service = 'kibana';
  let deployment = `deployment/${service}-deployment`;

  const localPort = options.localPort || 5602;
  const remotePort = options.remotePort || 5601;

  console.info(yellow(`=> Starting portFoward for "${deployment}" ${localPort}:${remotePort} (localPort:remotePort)`));

  await execSyncInherit(`kubectl port-forward ${deployment} ${localPort}:${remotePort}`);
}

export async function logs(options) {
  await assertTectonicRoot();

  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);
  await checkConfig(environment, config);
  const { project, computeZone, kubernetes, label } = config.gcloud;

  let service = options.service;
  let subservice = options.subservice;
  if (!service) {
    [service, subservice] = await getServicesPrompt(environment, 'select');
  }

  let labelName = service;
  if (subservice) labelName += `-${subservice}`;
  const podLabel = label || 'app';

  const query = `resource.type="k8s_container"\nresource.labels.project_id="${project}"\nresource.labels.location="${computeZone}"\nresource.labels.cluster_name="${kubernetes.clusterName}"\nresource.labels.namespace_name="default"\nlabels.k8s-pod/${podLabel}="${labelName}"`;

  const params = new URLSearchParams({ query });

  const url = `https://console.cloud.google.com/logs/query;${params.toString()}?project=${project}`;
  console.info(yellow('=> Opening Logs in GCloud UI'));
  console.info(url);
  let confirmed = await prompt({
    type: 'confirm',
    name: 'open',
    message: 'Open URL in browser?',
    initial: true,
  });
  if (!confirmed) process.exit(0);
  await open(url);
}

export async function bootstrap(options) {
  await assertTectonicRoot();

  const environment = options.environment || (await getEnvironmentPrompt());
  const config = readConfig(environment);

  const project =
    options.project ||
    (await prompt({
      type: 'text',
      message: 'Enter projectId:',
      initial: config.gcloud && config.gcloud.project,
    }));
  console.info(green(`bedrock cloud ${environment} ${project}`));
  console.info(yellow(`=> Bootstrap GKE cluster and services (environment: [${environment}], project: [${project}])`));
  await bootstrapProjectEnvironment(project, environment, config);
}
