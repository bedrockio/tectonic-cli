import path from 'path';
import { exec, execSyncInherit } from '../util/shell';
import { exit } from '../util/exit';

export async function checkDockerComposeCommand() {
  try {
    await exec('command -v docker-compose');
  } catch (e) {
    exit('Error: Docker-compose is not installed (https://docs.docker.com/compose/)');
  }
}

export default async function up() {
  await checkDockerComposeCommand();
  const dockerComposeFile = path.resolve(__dirname, '../../docker-compose.yml');
  await execSyncInherit(`docker-compose up -f ${dockerComposeFile}`);
}
