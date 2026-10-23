# Saki Recovery Demo

This is a deliberately broken, dependency-free Node.js HTTP service for a reproducible Saki Watch exercise. It is not a production outage or a benchmark.

Run `node server.mjs` from this folder. Node.js 22.13 or later is recommended.

The service is intended to listen on **127.0.0.1:16541**. Its health endpoint is **http://127.0.0.1:16541/health**, which must return HTTP 200 and `{"status":"ok","service":"Saki Recovery Demo"}`.

`service.json` contains the service name, loopback host, and port. The checked-in configuration intentionally contains an invalid port to reproduce a startup failure. Diagnose the actual process logs and make the smallest configuration change. Do not modify `server.mjs`, the host, or the start command.

In Saki Panel, create a `nodejs` instance with this folder as its workspace, start command `node server.mjs`, and restart policy `never`. Keep Watch automatic diagnosis and automatic approval off. Set its health check to the URL above, start the instance, and initiate diagnosis from the resulting incident. Review the proposed diff before approving it; Watch then starts the instance and validates it.

