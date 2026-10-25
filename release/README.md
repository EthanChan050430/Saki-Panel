# Saki Panel 5.1

Saki Panel is an open-source server management panel for Minecraft, Steam game servers, Docker containers, Docker Compose stacks, and ordinary processes.

Version 5.1 adds configurable Agent reminders, automatic retries after interrupted model streams, and commands across selected workspaces on the same server. It also improves file checkpoints, Watch approvals, reasoning controls, prompt caching, translations, and dark-mode layouts.

## Downloads

Get the packages from [Saki Panel 5.1 Releases](https://github.com/EthanChan050430/Saki-Panel/releases/tag/v5.1).

| File | Use |
| --- | --- |
| `saki-panel-v5.1-windows-x64.zip` | Windows x64 portable package with Node.js and runtime dependencies included. |
| `saki-panel-v5.1-linux-x64.tar.gz` | Linux x64 package with compiled application files. Requires Node.js 22.13 or newer, npm 9 or newer, and an internet connection for dependency installation. |
| `saki-panel-windows-amd64.exe` | Windows launcher, also included in the ZIP as `saki-panel.exe`. |
| `saki-panel-linux-amd64` | Linux launcher, also included in the archive as `saki-panel`. |
| `SHA256SUMS-v5.1.txt` | SHA-256 checksums for the four downloads above. |

The individual launchers need the application files from the matching archive. Download the ZIP or TAR.GZ for a complete installation.

## Windows x64

1. Extract `saki-panel-v5.1-windows-x64.zip` into a writable folder.
2. Run `saki-panel.exe` from that folder.
3. Open <http://localhost:5478>.

Node.js is bundled; no separate Node.js installation is needed.

## Linux x64

Install Node.js 22.13 or newer and npm 9 or newer, then run:

```bash
mkdir saki-panel-v5.1
tar -xzf saki-panel-v5.1-linux-x64.tar.gz -C saki-panel-v5.1
cd saki-panel-v5.1
npm ci
chmod +x saki-panel
./saki-panel
```

Open <http://localhost:5478>. Linux dependencies are installed on the target machine so native modules match its platform.

## Configuration and upgrades

The default login is `admin` / `admin123456`. The default ports are `5478` for the web console, `5479` for the Panel API, and `5480` for the local Daemon. Set a strong administrator password, `JWT_SECRET`, and `DAEMON_REGISTRATION_TOKEN` before exposing the services. See `.env.example` for settings.

Before upgrading, stop Saki Panel and back up `data/`, your `.env`, and any instance files stored outside `data/`. Extract 5.1 into a separate folder and copy your configuration and data into it. The Panel synchronizes the database schema at startup; keep the backup if you need to return to an older version.

Remote SSH terminals require an SSH account. Deploying the remote Daemon for instance management also requires Linux, Node.js 22.13 or newer, and npm on that server. Git operations require Git on the machine that holds the workspace.

Optional operations packs are downloaded from the Templates page and checked against their SHA-256 hashes and sizes. Downloading a pack does not run its scripts.

Check downloads with `Get-FileHash -Algorithm SHA256 <file>` on Windows or `sha256sum -c SHA256SUMS-v5.1.txt` on Linux when all four files are present. For a single download, compare its hash with the corresponding line in the checksum file.

[Documentation](https://github.com/EthanChan050430/Saki-Panel#readme) · [Report a bug](https://github.com/EthanChan050430/Saki-Panel/issues)
