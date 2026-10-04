# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files, media
and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.1 bootstrap

This first repository rung is intentionally small and real.

### Working

- local identity
- rooms and text chat
- `/join`
- `/me`
- `/nick`
- `/who`
- `/topic`
- `/help`
- local persistence
- capability-gated Action Bus
- inspectable activity ledger
- retro desktop-style React UI
- automated tests and build CI

### Planned

Agents, Ollama, attachments, WebRTC, voice/video, LAN discovery, synchronized
media, plugins and federation are not claimed as working yet.

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
