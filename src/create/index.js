import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import { exit } from '../util/exit';
import { queueTask, runTasks } from '../util/tasks';
import { replaceAll } from '../util/replace';
import { exec } from '../util/shell';
import { randomBytes } from 'crypto';

const COMPLETE_MESSAGE = `
  Installation Completed!
  New Tectonic Deployment environment has been created. To run the stack in Docker:

  tectonic up
`;

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

  queueTask(`Create Environment '${environment}' from template`, async () => {
    const tectonicDir = path.resolve('tectonic');
    fs.ensureDirSync(tectonicDir);

    const provisioningDir = path.resolve(tectonicDir, 'provisioning');
    if (!fs.existsSync(provisioningDir)) {
      const provisioningTemplateDir = path.resolve(__dirname, '../../templates/provisioning');
      try {
        // console.info(`Copy provisioning template: ${provisioningTemplateDir} => ${provisioningDir}`);
        fs.copySync(provisioningTemplateDir, provisioningDir);
      } catch (err) {
        console.error(err);
      }
    }

    const environmentsDir = path.resolve(tectonicDir, 'environments');
    fs.ensureDirSync(environmentsDir);

    const environmentDir = path.resolve(environmentsDir, environment);
    if (fs.existsSync(environmentDir)) {
      exit(`Tectonic Environment '${environment}' already exists`);
    } else {
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
    const APP_URL = `https://${domain}`;
    const API_URL = `https://api.${domain}`;

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

  // queueTask('Finalizing', async () => {});

  try {
    await runTasks();
  } catch (e) {
    console.error(e.message);
  }

  console.log(kleur.yellow(COMPLETE_MESSAGE));
}
