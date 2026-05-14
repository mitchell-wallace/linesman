# laps-viewer

A GUI companion for the [`laps`](https://github.com/microbeads/laps) CLI — a task tracker for AI coding agents. Reads and writes the same `.laps/laps.json` file, with a polling watcher so external edits stay in sync.

## Commands

```sh
npm install           # install deps
npm run dev           # dev mode (electron-vite + HMR)
npm run build         # production build
npm run start         # preview the production build
npm test              # vitest unit tests
npm run e2e           # playwright (stage 3)
node bin/laps-viewer.js  # launch from any directory containing .laps/laps.json
```
