# linesman

A GUI companion for the [`laps`](https://github.com/mitchell-wallace/laps) CLI — a task tracker for AI coding agents. Reads and writes the same `.laps/laps.json` file, with a polling watcher so external edits stay in sync.

Supports multiple instances — launch from different project directories and each gets its own window showing the folder name in the title bar.

## Install

### Linux / macOS

```sh
curl -sSL https://raw.githubusercontent.com/mitchell-wallace/linesman/main/install.sh | bash
```

Installs to `~/.local/bin/linesman` (Linux) or `/Applications/linesman.app` (macOS).

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/mitchell-wallace/linesman/main/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\Programs\linesman\`.

### Install a specific version

```sh
# Linux/macOS
curl -sSL https://raw.githubusercontent.com/mitchell-wallace/linesman/main/install.sh | bash -s 0.1.0

# Windows
irm https://raw.githubusercontent.com/mitchell-wallace/linesman/main/install.ps1 | iex -Args "0.1.0"
```

### First-launch security warnings

The app is unsigned. On first launch:

- **macOS**: Right-click the app → Open → Open again. macOS remembers this choice.
- **Windows**: Click "More info" → "Run anyway" in the SmartScreen popup.

## Usage

```sh
cd /path/to/your/project
linesman
```

Linesman discovers the `.laps/laps.json` file by walking up from the current directory. You can also set `LAPS_FILE` explicitly:

```sh
LAPS_FILE=/path/to/.laps/laps.json linesman
```

## Development

```sh
npm install           # install deps
npm run dev           # dev mode (electron-vite + HMR)
npm run build         # production build
npm run start         # preview the production build
npm test              # vitest unit tests
npm run e2e           # playwright e2e tests
npm run typecheck     # TypeScript checks
```

## Release

1. Bump the version in `VERSION`
2. Merge to `main`
3. CI auto-tags and publishes builds for Linux, macOS, and Windows to [GitHub Releases](https://github.com/mitchell-wallace/linesman/releases)
