# PHircQ Roadmap

## Rung 1 — Local runtime
- [x] Actor / Room / Message model
- [x] Action Bus + capability authority
- [x] room chat + IRC commands
- [x] local persistence
- [x] activity ledger
- [x] React shell
- [x] CI

## Rung 2 — Durable persistence
- [x] packaged SQLite via sql.js
- [x] normalized local runtime tables
- [x] migration from v0.1 browser state
- [x] attachment metadata + SHA-256
- [x] bounded IndexedDB blob storage
- [x] governed local file attachment/download

## Rung 3 — Agents
- [x] AgentAdapter interface
- [x] Ollama discovery
- [x] configurable local endpoint
- [x] persisted agent definitions
- [x] MANAGE_AGENT and INVOKE_AGENT authority
- [x] agent room participation through message.send
- [x] enable / disable controls
- [x] recent-room context
- [ ] autonomous triggers and subscriptions
- [ ] non-Ollama provider adapters

## Rung 4 — Transport core
- [x] formal Transport contract
- [x] paired two-runtime acceptance harness
- [x] WebRTC RTCDataChannel transport
- [x] explicit persisted peer trust
- [x] ECDSA P-256 signed frames
- [x] public-key fingerprints
- [x] replay / duplicate rejection
- [x] governed remote message admission
- [x] real browser WebRTC strict-local self-test
- [ ] user-facing offer / answer workflow
- [ ] reconnect / link lifecycle UX

## Rung 5 — Native + LAN
- [ ] Tauri desktop shell
- [ ] mDNS / LAN discovery
- [ ] STRICT LOCAL mode for native discovery/linking
- [ ] direct peer files

## Later
- [ ] voice/video/screen share
- [ ] conference rooms
- [ ] synchronized media rooms
- [ ] plugins
- [ ] federation
