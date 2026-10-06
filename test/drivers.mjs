import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const harness of ['claude', 'codex', 'opencode', 'pi']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./driver.mjs', import.meta.url))], {
    env: { ...process.env, MUTAGATE_DRIVER_HARNESS: harness }, stdio: 'inherit', timeout: 300000
  });
  if (result.status !== 0) process.exitCode = 1;
}
