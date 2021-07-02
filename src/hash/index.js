import path from 'path';
import os from 'os';
import { execSyncInherit, withDir } from '../util/shell';

export default async function hash() {
  await withDir(path.resolve(os.homedir(), '.tectonic'), async () => {
    await execSyncInherit('git rev-parse --short HEAD');
  });
}
