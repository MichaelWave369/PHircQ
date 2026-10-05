# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.2 persistence rung

### Working

- local identity
- rooms and text chat
- `/join`, `/me`, `/nick`, `/who`, `/topic`, `/help`
- capability-gated Action Bus
- inspectable activity ledger
- packaged `sql.js` SQLite persistence
- migration from the v0.1 browser snapshot
- local file attachments
- SHA-256 attachment receipts
- 25 MiB per-file attachment limit
- 100 MiB bounded browser blob store
- attachment bytes stored in IndexedDB
- attachment metadata stored in SQLite
- local attachment download
- retro desktop-style React UI
- automated tests and build CI

The browser build packages the SQLite WASM asset locally. It does not fetch the
database engine from a CDN.

### Planned

Agents, Ollama, WebRTC, voice/video, LAN discovery, synchronized media,
plugins and federation are not claimed as working yet.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3690`.

## Verify

```bash
npm test
npm run build
```

See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).

## License

MIT.
