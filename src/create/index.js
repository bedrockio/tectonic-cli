import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import { exit } from '../util/exit';
import { kebabCase, snakeCase, startCase } from 'lodash';
import { queueTask, runTasks } from '../util/tasks';
import { removeFiles } from '../util/file';
import { replaceAll } from '../util/replace';
import { exec } from '../util/shell';
import { randomBytes } from 'crypto';
import { getEnvironments, updateServiceYamlEnv } from '../cloud/utils';

const COMPLETE_MESSAGE = `
  Installation Completed!
  New Tectonic Deployment environment has been created. To run the stack in Docker:

  tectonic up
`;

export default async function create(options) {
  const {
    project,
    environment = 'staging',
    domain = '',
    'admin-email': adminEmail = '',
    'admin-password': adminPassword = '',
  } = options;

  if (!project) exit('GCloud Project name is required');
  if (!environment) exit('Environment is required');
  if (!domain) exit('Domain is required');
  if (!adminEmail) exit('adminEmail is required');

  // "project" will accept any casing
  const kebab = kebabCase(project);
  const under = snakeCase(project);

  queueTask('Create Environment', async () => {
    const tectonicDir = './tectonics';
    fs.ensureDirSync(tectonicDir);

    const deploymentDir = path.join(tectonicDir, 'deployment');
    fs.ensureDirSync(deploymentDir);

    const provisioningDir = path.join(deploymentDir, 'provisioning');
    if (!fs.existsSync(provisioningDir)) {
      console.log(path.resolve(__dirname, '../../templates/provisioning'));
      console.log(path.resolve(provisioningDir));
      // try {
      //   fs.copySync('/tmp/myfile', '/tmp/mynewfile')
      //   console.log('success!')
      // } catch (err) {
      //   console.error(err)
      // }
    }

    const environmentsDir = path.join(deploymentDir, 'environments');
    fs.ensureDirSync(environmentsDir);

    const environmentDir = path.resolve(environmentsDir, environment);
    if (fs.existsSync(environmentDir)) {
      exit(`Tectonic Environment '${environment}' already exists`);
    } else {
      fs.mkdirSync(environmentDir);
      // Copy from template
    }

    // Create config.json
  });

  // queueTask('Configure Environment', async () => {
  //   const appName = startCase(project);
  //   const JWT_SECRET = await exec('openssl rand -base64 30');
  //   const ADMIN_PASSWORD = adminPassword || randomBytes(8).toString('hex');

  //   await replaceAll('*.{js,md,yml,tf,conf,json,env}', (str) => {
  //     str = str.replace(/JWT_SECRET=(.+)/g, `JWT_SECRET=${JWT_SECRET}`);
  //     str = str.replace(/ADMIN_PASSWORD=(.+)/g, `ADMIN_PASSWORD=${ADMIN_PASSWORD}`);
  //     str = str.replace(/bedrock-foundation/g, kebab);
  //     str = str.replace(/bedrock\.foundation/g, domain);
  //     str = str.replace(/bedrock-core-services/g, `${kebab}-services`);
  //     str = str.replace(/Bedrock (Staging|Production)/g, `${appName} $1`);
  //     str = str.replace(/bedrock_(dev|staging|production)/g, `${under}_$1`);
  //     str = str.replace(/bedrock-(web|api|dev|staging|production)/g, `${kebab}-$1`);
  //     str = str.replace(/\bBedrock\b/g, appName);
  //     return str;
  //   });

  //   const environments = await getEnvironments();
  //   for (let environment of environments) {
  //     const secret = await exec('openssl rand -base64 30');
  //     const password = adminPassword || randomBytes(8).toString('hex');
  //     updateServiceYamlEnv(environment, 'api', 'JWT_SECRET', secret);
  //     updateServiceYamlEnv(environment, 'api', 'ADMIN_PASSWORD', password);
  //   }

  //   await removeFiles('CONTRIBUTING.md');
  //   await removeFiles('LICENSE');
  //   await removeFiles('.git');
  // });

  // queueTask('Finalizing', async () => {});

  try {
    await runTasks();
  } catch (e) {
    console.error(e.message);
  }

  console.log(kleur.yellow(COMPLETE_MESSAGE));
}
