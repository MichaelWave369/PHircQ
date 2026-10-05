# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.3 agents rung

### Working

- local identity, rooms and text chat
- IRC-style commands
- capability-gated Action Bus
- inspectable activity ledger
- packaged `sql.js` SQLite persistence
- local governed file attachments with SHA-256 receipts
- generic `AgentAdapter` boundary
- Ollama discovery through `/api/tags`
- configurable local Ollama endpoint
- local agent creation and enable/disable state
- explicit `MANAGE_AGENT` and `INVOKE_AGENT` capabilities
- agent responses posted through the same governed message path as humans
- persisted agent definitions
- room-context prompts using recent local messages
- retro desktop-style React UI
- automated tests and CI

Ollama defaults to `http://localhost:11434`. Browser access may require the
local Ollama server to permit the PHircQ origin. PHircQ does not silently route
failed local requests to a cloud provider.

### Planned

WebRTC, voice/video, LAN discovery, synchronized media, plugins and federation
are not claimed as working yet.

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
