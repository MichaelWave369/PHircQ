# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.4 transport rung

### Working

- local identity, rooms, text chat and IRC-style commands
- capability-gated Action Bus and inspectable ledger
- packaged SQLite persistence
- governed local attachments with SHA-256 receipts
- provider-neutral AgentAdapter and local Ollama agents
- formal Transport interface
- paired in-memory transport acceptance harness
- WebRTC RTCDataChannel transport
- ECDSA P-256 signed peer frames
- SHA-256 public-key fingerprints
- explicit persisted peer trust
- replay / duplicate frame rejection
- remote messages enter the same governed message path as local actors
- strict-local browser WebRTC self-test with `iceServers: []`

### Experimental

WebRTC transport is now real and testable, but PHircQ does **not yet** claim a
complete user-facing remote connection workflow. Manual signaling, rendezvous,
reconnect UX, direct peer file transfer and multi-peer rooms remain later rungs.

The browser self-test deliberately configures no external STUN or TURN service.
It proves a real local RTCDataChannel can open and carry a PHircQ payload.

### Planned

- user-facing peer link / signaling workflow
- native Tauri shell
- mDNS LAN discovery
- direct peer file transfer
- voice/video
- synchronized media
- plugins and federation

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
