# Security

Saki Panel can start, stop, and edit processes on every connected node. Treat a leaked admin session as root on those machines.

## Report a vulnerability

Do not open a public issue.

Use [GitHub private vulnerability reporting](https://github.com/EthanChan050430/Saki-Panel/security/advisories/new). Include version, install method, and steps to reproduce.

## Before the panel is reachable

Change these in `.env` (see `.env.example`):

- `JWT_SECRET`
- `ADMIN_PASSWORD` — default is `admin` / `admin123456`
- `DAEMON_REGISTRATION_TOKEN`

Do not expose ports 5478–5480 to the internet with the defaults still in place.

## Scope

Please report:

- Auth bypass, privilege escalation, or RBAC holes
- Path traversal or command injection on the daemon
- Ways to skip Saki approval gates or run blocked commands
- SSRF from panel/daemon outbound requests

Please do not report:

- Missing `JWT_SECRET` rotation on a local `npm run dev` setup
- Dependency version nags without a working exploit
