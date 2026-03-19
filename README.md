# JSONL Viewer

Static, local-first JSON and JSONL viewer for developers.

## Features

- Paste JSON or JSONL directly
- Upload `.json`, `.jsonl`, `.ndjson`, `.txt`
- Drag and drop file input
- Auto-detect JSON vs JSONL with manual override
- Pretty print and minify
- Tree view for JSON
- Table view for JSON arrays and JSONL
- JSONL error reporting with line numbers
- Dark/light mode with system detection and manual override
- Browser persistence using IndexedDB-backed storage
- Fully frontend; deployable to any static host

## Tech

- Vite
- React
- TypeScript
- Tailwind CSS import plus app-specific CSS
- Vitest for unit tests
- Playwright for browser tests

## Development

```bash
npm install
npm run dev
```

## Test

Unit tests:

```bash
npm test
```

Browser tests:

```bash
npx playwright install
npm run test:e2e
```

## Build

```bash
npm run build
```

## GitHub Actions

Included workflows:

- `.github/workflows/ci.yml`
  - installs dependencies
  - runs unit tests
  - runs Playwright browser tests
  - builds production output
- `.github/workflows/deploy-sftp.yml`
  - builds and deploys `dist/` over SFTP using password auth
- `.github/workflows/deploy-sftp-key.yml`
  - builds and deploys `dist/` using SSH key + rsync

Expected GitHub Secrets:

- `SFTP_HOST`
- `SFTP_PORT`
- `SFTP_USERNAME`
- `SFTP_PASSWORD` or `SFTP_SSH_KEY`
- `SFTP_REMOTE_PATH`

Use one deploy workflow style, not both.

## Notes

- No server-side processing or storage
- Session data is persisted locally in the browser
- For very large payloads, a future version should move parsing into a Web Worker and virtualize large tables more aggressively
