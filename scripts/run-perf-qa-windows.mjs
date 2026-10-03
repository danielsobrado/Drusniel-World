/** Run hardware WebGPU QA in native Windows Chromium, including from WSL. */
import { execFileSync, spawn } from 'node:child_process';
import { release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts', 'run-perf-qa.mjs');

function readCommand(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function windowsRuntime() {
  if (process.platform === 'win32') return { executable: process.execPath, runner };
  if (process.platform !== 'linux' || !/microsoft/i.test(release())) {
    throw new Error('qa:perf:windows requires Windows or WSL. Use qa:perf on native Linux/macOS.');
  }
  const executable = readCommand('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source",
  ]);
  if (!executable) throw new Error('Install Node.js on Windows and make node.exe available on the Windows PATH.');
  return {
    executable: readCommand('wslpath', ['-u', executable]),
    runner: readCommand('wslpath', ['-w', runner]),
  };
}

try {
  const runtime = windowsRuntime();
  const args = process.argv.slice(2);
  if (process.platform !== 'win32') {
    for (let index = 0; index < args.length - 1; index += 1) {
      if (['--out', '--screenshot', '--cpu-profile'].includes(args[index])
          && path.isAbsolute(args[index + 1])) {
        args[index + 1] = readCommand('wslpath', ['-w', args[index + 1]]);
        index += 1;
      }
    }
  }
  console.log('Running hardware WebGPU QA with native Windows Node.js and Playwright Chromium.');
  const child = spawn(runtime.executable, [runtime.runner, '--headed', ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(`Windows WebGPU QA failed: ${error.message}`);
  process.exitCode = 1;
}
