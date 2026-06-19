const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const host = '127.0.0.1';
const startPort = 5173;
const timeoutMs = 15000;
const pollMs = 250;

function findFreePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(findFreePort(port + 1));
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      const { port: freePort } = server.address();
      server.close(() => resolve(freePort));
    });

    server.listen(port, host);
  });
}

function waitForServer(url, deadline) {
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
  const port = await findFreePort(startPort);
  const url = `http://${host}:${port}`;

  const vite = spawn('npm', ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort'], {
    stdio: 'inherit',
    env: process.env,
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    vite.kill('SIGTERM');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  vite.on('exit', (code) => {
    if (!shuttingDown && code !== 0) process.exit(code ?? 1);
  });

  await waitForServer(url, Date.now() + timeoutMs);

  const electron = spawn('./node_modules/.bin/electron', ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: url,
    },
  });

  electron.on('exit', (code, signal) => {
    shutdown();
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
