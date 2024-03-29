import path from 'path';
import kleur from 'kleur';
import { homedir } from 'os';
import { exec, withDir } from '../util/shell';

export default async function update() {
  await withDir(path.resolve(homedir(), '.tectonic'), async () => {
    await exec(`git pull`);
  });
  console.log(kleur.green('Updated!'));
}
