import kleur from 'kleur';
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

  if (!project) throw new Error('Project name required');
  if (!environment) throw new Error('Environment required');
  if (!domain) throw new Error('Domain required');
  if (!adminEmail) throw new Error('adminEmail required');

  // "project" will accept any casing
  const kebab = kebabCase(project);
  const under = snakeCase(project);

  queueTask('Create Environment', async () => {});

  queueTask('Configure Environment', async () => {
    const appName = startCase(project);
    const JWT_SECRET = await exec('openssl rand -base64 30');
    const ADMIN_PASSWORD = adminPassword || randomBytes(8).toString('hex');

    await replaceAll('*.{js,md,yml,tf,conf,json,env}', (str) => {
      str = str.replace(/JWT_SECRET=(.+)/g, `JWT_SECRET=${JWT_SECRET}`);
      str = str.replace(/ADMIN_PASSWORD=(.+)/g, `ADMIN_PASSWORD=${ADMIN_PASSWORD}`);
      str = str.replace(/bedrock-foundation/g, kebab);
      str = str.replace(/bedrock\.foundation/g, domain);
      str = str.replace(/bedrock-core-services/g, `${kebab}-services`);
      str = str.replace(/Bedrock (Staging|Production)/g, `${appName} $1`);
      str = str.replace(/bedrock_(dev|staging|production)/g, `${under}_$1`);
      str = str.replace(/bedrock-(web|api|dev|staging|production)/g, `${kebab}-$1`);
      str = str.replace(/\bBedrock\b/g, appName);
      return str;
    });

    const environments = await getEnvironments();
    for (let environment of environments) {
      const secret = await exec('openssl rand -base64 30');
      const password = adminPassword || randomBytes(8).toString('hex');
      updateServiceYamlEnv(environment, 'api', 'JWT_SECRET', secret);
      updateServiceYamlEnv(environment, 'api', 'ADMIN_PASSWORD', password);
    }

    await removeFiles('CONTRIBUTING.md');
    await removeFiles('LICENSE');
    await removeFiles('.git');
  });

  queueTask('Finalizing', async () => {});

  await runTasks();

  console.log(kleur.yellow(COMPLETE_MESSAGE));
}
