# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.6 native LAN rung

### Working

- local identity, rooms, text chat and IRC-style commands
- capability-gated Action Bus and inspectable ledger
- packaged SQLite persistence
- governed local attachments with SHA-256 receipts
- provider-neutral AgentAdapter and local Ollama agents
- WebRTC RTCDataChannel transport
- ECDSA P-256 signed peer frames
- explicit peer fingerprint trust
- Paper Link manual two-client WebRTC workflow
- **Tauri v2 desktop shell scaffold**
- **native mDNS/DNS-SD discovery**
- native PHircQ service advertisement as `_phircq._tcp.local.`
- real local TCP reachability probe for discovered PHircQ nodes
- browser build remains honest and does not fake native LAN discovery
- native discovery does not auto-trust or auto-admit peers

### Native desktop

Install Rust and the platform prerequisites for Tauri, then:

```bash
npm install
npm run tauri:dev
```

The regular web build still works with:

```bash
npm run dev
```

The desktop shell exposes native commands only when PHircQ is running inside
Tauri. In an ordinary browser the LAN panel explicitly reports that native
discovery is unavailable.

### LAN discovery contract

The native app publishes and browses:

```text
_phircq._tcp.local.
```

Discovery TXT metadata includes:

```text
peer_id
display_name
version
paper_link=1
trust=explicit
```

Each desktop node also opens a small ephemeral TCP probe endpoint and advertises
that actual port through DNS-SD. The UI can probe a discovered node and verify a
versioned PHircQ hello before calling it reachable.

**Discovery is not trust.** A discovered device does not automatically become a
REMOTE_PEER actor and does not bypass the fingerprint trust path.

### Still planned

- automatic LAN handoff from discovery into signed peer linking
- direct peer file transfer
- native persistent identity/key storage
- optional rendezvous / Internet traversal mode
- voice/video/screen share
- synchronized media
- installers/signing/release packaging
- plugins and federation

## Verify

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).

## License

MIT.
