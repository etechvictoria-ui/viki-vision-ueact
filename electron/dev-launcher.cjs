const http = require('http');
const { spawn } = require('child_process');

const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
const timeoutMs = 15000;
const pollMs = 250;

function waitForServer(deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, pollMs);
      });

      req.setTimeout(pollMs, () => {
        req.destroy();
      });
    };

    attempt();
  });
}

async function main() {
  await waitForServer(Date.now() + timeoutMs);

  const child = spawn('./node_modules/.bin/electron', ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: url,
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
