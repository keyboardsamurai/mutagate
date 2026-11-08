import fs from 'node:fs';
import { hookConfig } from '../scripts/mutagate.mjs';

export function sharedHooks() {
  const config = hookConfig('codex');
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        // Arguments from the built command, so install.cjs stays their only builder (POSIX wrapper or Windows absolute form). The install stamp is a placeholder, so a version bump leaves the template unchanged.
        handler.command = 'MUTAGATE_HOOK ' + handler.command.split(/ hook | sh "\$f" /).pop().replace(/ # mutagate$/, '').replace(/ --installed \S+/, ' --installed MUTAGATE_VERSION');
      }
    }
  }
  return config;
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(new URL('../scripts/hooks.json', import.meta.url), JSON.stringify(sharedHooks(), null, 2) + '\n');
}
