import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import { exit } from '../util/exit';
import { queueTask, runTasks } from '../util/tasks';
import { replaceAll } from '../util/replace';
import { exec } from '../util/shell';
import { prompt } from '../util/prompt';
import {
  validateEmail,
  validateDomain,
  validateDomainURL,
  validateComputeZone,
  validateMachineType,
} from '../util/validation';
import { bootstrapProjectEnvironment } from '../cloud/bootstrap';
import { randomBytes } from 'crypto';

const TECTONIC_VERSION = 'latest'; // Change to 1.x once stable

export default async function create(options) {
  const project = options.project.toLowerCase();
  const environment = options.environment.toLowerCase();

  const tectonicDir = path.resolve('tectonic');
  const environmentsDir = path.resolve(tectonicDir, 'environments');
  const environmentDir = path.resolve(environmentsDir, environment);

  // Templating and creation of tectonic enviroment configuration
  if (fs.existsSync(environmentDir)) {
    console.info(kleur.yellow(`Existing configuration '/tectonic/environments/${environment}/config.json':`));
    const config = require(path.resolve(environmentDir, 'config.json'));
    console.dir(config, { depth: null, colors: true });
    let confirmed = await prompt({
      type: 'confirm',
      name: 'open',
      message: `Tectonic Environment '${environment}' already exists, do you want to continue with the existing configuration?`,
      initial: true,
    });
    if (!confirmed) process.exit(0);
    console.info(kleur.yellow(`Skipping templating and keeping current configuration`));
  } else {
    // Prompt for domain, adminEmail, adminPassword, computeZone, app_url and api_url
    // Not listed in command.json, because we don't want to prompt the user if the environment already exists
    const domain = await prompt({
      type: 'text',
      message: 'Enter domain',
      validate: validateDomain,
    });
    const APP_URL = await prompt({
      type: 'text',
      message: 'Enter Tectonic Dashboard url',
      initial: `https://tectonic.${domain}`,
      validate: validateDomainURL,
    });
    const API_URL = await prompt({
      type: 'text',
      message: 'Enter Tectonic API url',
      initial: `https://tectonic-api.${domain}`,
      validate: validateDomainURL,
    });
    const adminEmail = await prompt({
      type: 'text',
      message: 'Enter admin email',
      initial: `admin@${domain}`,
      validate: validateEmail,
    });
    const adminPassword = await prompt({
      type: 'password',
      message: 'Enter admin password (optional)',
    });
    const computeZone = await prompt({
      type: 'text',
      message: 'Enter GKE cluster Compute zone',
      initial: 'us-east1-c',
      validate: validateComputeZone,
    });
    const machineType = await prompt({
      type: 'text',
      message: 'Enter GKE cluster Machine type',
      initial: 'n2-standard-2',
      validate: validateMachineType,
    });
    const mongoDiskSize = await prompt({
      type: 'text',
      message: 'Enter GKE MongoDB disk size (GB)',
      initial: '200',
    });
    const elasticsearchDiskSize = await prompt({
      type: 'text',
      message: 'Enter GKE Elasticsearch disk size (GB)',
      initial: '200',
    });
    const tectonicVersion = await prompt({
      type: 'text',
      message: 'Enter Tectonic Version',
      initial: TECTONIC_VERSION,
    });

    queueTask(`Create Environment '${environment}' from template`, async () => {
      fs.ensureDirSync(tectonicDir);

      const dockerComposeSource = path.resolve(__dirname, '../../docker-compose.yml');
      const dockerComposeTarget = path.resolve(tectonicDir, 'docker-compose.yml');

      try {
        fs.copySync(dockerComposeSource, dockerComposeTarget);
      } catch (err) {
        console.error(err);
      }

      fs.ensureDirSync(environmentsDir);

      if (!fs.existsSync(environmentDir)) {
        const environmentTemplateDir = path.resolve(__dirname, '../../templates/environment');
        try {
          // console.info(`Copy environment template: ${environmentTemplateDir} => ${environmentDir}`);
          fs.copySync(environmentTemplateDir, environmentDir);
        } catch (err) {
          console.error(err);
        }
      }
    });

    queueTask(`Configure Environment '${environment}'`, async () => {
      const JWT_SECRET = await exec('openssl rand -base64 30');
      const APPLICATION_JWT_SECRET = await exec('openssl rand -base64 30');
      const ACCESS_JWT_SECRET = await exec('openssl rand -base64 30');
      const ADMIN_PASSWORD = adminPassword || randomBytes(8).toString('hex');
      const BUCKET_PREFIX = `${project}-tectonic-${environment}`;
      const MONGO_DISK_SIZE = mongoDiskSize || '200';
      const ELASTICSEARCH_DISK_SIZE = elasticsearchDiskSize || '200';

      await replaceAll(`tectonic/environments/${environment}/**/*.{js,md,yml,tf,conf,json,env}`, (str) => {
        str = str.replace(/<ENV_NAME>/g, environment);
        str = str.replace(/<JWT_SECRET>/g, JWT_SECRET);
        str = str.replace(/<APPLICATION_JWT_SECRET>/g, APPLICATION_JWT_SECRET);
        str = str.replace(/<ACCESS_JWT_SECRET>/g, ACCESS_JWT_SECRET);
        str = str.replace(/<PROJECT>/g, project);
        str = str.replace(/<DOMAIN>/g, domain.toLowerCase());
        str = str.replace(/<APP_URL>/g, APP_URL.toLowerCase());
        str = str.replace(/<API_URL>/g, API_URL.toLowerCase());
        str = str.replace(/<BUCKET_PREFIX>/g, BUCKET_PREFIX);
        str = str.replace(/<COMPUTE_ZONE>/g, computeZone.toLowerCase());
        str = str.replace(/<MACHINE_TYPE>/g, machineType.toLowerCase());
        str = str.replace(/<MONGO_DISK_SIZE>/g, MONGO_DISK_SIZE);
        str = str.replace(/<ELASTICSEARCH_DISK_SIZE>/g, ELASTICSEARCH_DISK_SIZE);
        str = str.replace(/<ADMIN_EMAIL>/g, adminEmail.toLowerCase());
        str = str.replace(/<ADMIN_PASSWORD>/g, ADMIN_PASSWORD);
        str = str.replace(/<TECTONIC_VERSION>/g, tectonicVersion.toLowerCase());
        return str;
      });
    });

    try {
      await runTasks();
      const templatingDoneMessage = `New Tectonic Deployment configuration for environment '${environment}' has been created:`;
      console.info(kleur.green(templatingDoneMessage));
      const config = require(path.resolve(environmentDir, 'config.json'));
      console.dir(config, { depth: null, colors: true });
    } catch (e) {
      console.error(e.message);
    }
  }

  // Bootstrap
  let confirmed = await prompt({
    type: 'confirm',
    name: 'open',
    message: `Your GKE cluster will now be provisioned, do you want to continue?`,
    initial: false,
  });
  if (!confirmed) process.exit(0);

  const config = require(path.resolve(environmentDir, 'config.json'));
  const configProject = config && config.gcloud && config.gcloud.project;
  if (project != configProject) {
    exit(`Project argument '${project}' does not match project in config.json: '${configProject}'`);
  }

  await bootstrapProjectEnvironment(project, environment, config);
}
