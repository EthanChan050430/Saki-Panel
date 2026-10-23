import http from 'node:http';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('./service.json', import.meta.url), 'utf8'));
console.log(`[startup] service=${config.name} host=${config.host} port=${config.port}`);
const server = http.createServer((request, response) => {
  console.log(`[request] ${request.method} ${request.url}`);
  if (request.url !== '/health') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ status: 'ok', service: config.name }));
});
try {
  server.listen(config.port, config.host, () => {
    console.log(`[ready] http://${config.host}:${config.port}/health`);
  });
} catch (error) {
  console.error(error.stack);
  // Give the Windows PTY time to deliver the last error before exiting.
  setTimeout(() => process.exit(1), 500);
}

