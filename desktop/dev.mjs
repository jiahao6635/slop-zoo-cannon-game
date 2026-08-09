import { spawn } from 'node:child_process';

import electronPath from 'electron';

const developmentUrl = 'http://127.0.0.1:5173/';
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(npmExecutable, ['run', 'dev', '--', '--strictPort'], {
  stdio: 'inherit',
  env: process.env,
});

let electron = null;
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stop(electron);
    stop(vite);
  });
}

try {
  await waitForServer(developmentUrl, 30_000);
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: developmentUrl },
  });
  const exitCode = await waitForExit(electron);
  stop(vite);
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(electron);
  stop(vite);
  process.exitCode = 1;
}

async function waitForServer(url, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with code ${vite.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready at ${url}.`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function stop(child) {
  if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
}
