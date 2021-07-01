import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import { exit } from '../util/exit';
import { queueTask, runTasks } from '../util/tasks';
import { replaceAll } from '../util/replace';
import { exec } from '../util/shell';
import { prompt } from '../util/prompt';
import { bootstrapProjectEnvironment } from '../cloud/bootstrap';
import { randomBytes } from 'crypto';

export default async function create(options) {
  const {
    project,
    environment,
    domain,
    'admin-email': adminEmail,
    'admin-password': adminPassword = '',
    'compute-zone': computeZone = 'us-east1-c',
  } = options;

  if (!project) exit('GCloud Project name is required');
  if (!environment) exit('Environment is required');
  if (!domain) exit('Domain is required');
  if (!adminEmail) exit('adminEmail is required');

  const tectonicDir = path.resolve('tectonic');
  const provisioningDir = path.resolve(tectonicDir, 'provisioning');
  const environmentsDir = path.resolve(tectonicDir, 'environments');
  const environmentDir = path.resolve(environmentsDir, environment);

  const APP_URL = await prompt({
    type: 'text',
    message: 'Enter APP url',
    initial: `https://${domain}`,
    validate: validateDomain,
  });

  const API_URL = await prompt({
    type: 'text',
    message: 'Enter API url',
    initial: `https://api.${domain}`,
    validate: validateDomain,
  });

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
    queueTask(`Create Environment '${environment}' from template`, async () => {
      fs.ensureDirSync(tectonicDir);

      if (!fs.existsSync(provisioningDir)) {
        const provisioningTemplateDir = path.resolve(__dirname, '../../templates/provisioning');
        try {
          // console.info(`Copy provisioning template: ${provisioningTemplateDir} => ${provisioningDir}`);
          fs.copySync(provisioningTemplateDir, provisioningDir);
        } catch (err) {
          console.error(err);
        }
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

      await replaceAll(`tectonic/environments/${environment}/**/*.{js,md,yml,tf,conf,json,env}`, (str) => {
        str = str.replace(/<ENV_NAME>/g, environment);
        str = str.replace(/<JWT_SECRET>/g, JWT_SECRET);
        str = str.replace(/<APPLICATION_JWT_SECRET>/g, APPLICATION_JWT_SECRET);
        str = str.replace(/<ACCESS_JWT_SECRET>/g, ACCESS_JWT_SECRET);
        str = str.replace(/<PROJECT>/g, project);
        str = str.replace(/<DOMAIN>/g, domain);
        str = str.replace(/<APP_URL>/g, APP_URL);
        str = str.replace(/<API_URL>/g, API_URL);
        str = str.replace(/<BUCKET_PREFIX>/g, BUCKET_PREFIX);
        str = str.replace(/<COMPUTE_ZONE>/g, computeZone);
        str = str.replace(/<ADMIN_EMAIL>/g, adminEmail);
        str = str.replace(/<ADMIN_PASSWORD>/g, ADMIN_PASSWORD);
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
    message: `Your cluster will now be provisioned, do you want to continue?`,
    initial: true,
  });
  if (!confirmed) process.exit(0);

  const config = require(path.resolve(environmentDir, 'config.json'));
  const configProject = config && config.gcloud && config.gcloud.project;
  if (project != configProject) {
    exit(`Project argument '${project}' does not match project in config.json: '${configProject}'`);
  }

  await bootstrapProjectEnvironment(project, environment, config);
}

const DOMAIN_REG = /^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;

function validateDomain(str = '') {
  if (!DOMAIN_REG.test(str)) {
    return 'Enter valid http(s)://domain';
  }
  return true;
}
