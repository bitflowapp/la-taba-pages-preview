// Recovery archives and row fingerprints never belong in a Git checkout,
// including another worktree reached through an existing directory junction.
import fs from 'node:fs';
import path from 'node:path';
export function assertPrivateOutputDirectory(output) {
  const absolute=path.resolve(output);
  let existing=absolute;
  while(!fs.existsSync(existing)) {
    const parent=path.dirname(existing);
    if(parent===existing) throw Error('Recovery output parent does not exist');
    existing=parent;
  }
  let directory=fs.realpathSync(existing);
  if(!fs.statSync(directory).isDirectory()) directory=path.dirname(directory);
  for(;;) {
    if(fs.existsSync(path.join(directory,'.git'))) throw Error('Recovery output must stay outside Git checkouts');
    const parent=path.dirname(directory);
    if(parent===directory) break;
    directory=parent;
  }
  return absolute;
}
