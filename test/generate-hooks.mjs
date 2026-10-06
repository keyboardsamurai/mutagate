import fs from 'node:fs';
import { hookConfig } from '../scripts/mutagate.mjs';

export function sharedHooks() {
  const config = hookConfig('codex');
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        handler.command = 'MUTAGATE_HOOK ' + handler.command.split(' hook ')[1];
      }
    }
  }
  return config;
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(new URL('../scripts/hooks.json', import.meta.url), JSON.stringify(sharedHooks(), null, 2) + '\n');
}
