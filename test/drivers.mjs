import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Copilot on Windows is experimental with no claim: a win32 install writes only a powershell command (#35 D24, ADR-0021).
for (const harness of ['claude', 'codex', 'opencode', 'pi', ...process.platform === 'win32' ? [] : ['copilot']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./driver.mjs', import.meta.url))], {
    env: { ...process.env, MUTAGATE_DRIVER_HARNESS: harness }, stdio: 'inherit', timeout: 300000
  });
  if (result.status !== 0) process.exitCode = 1;
}
