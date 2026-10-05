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

## Rung 5 — Paper Link peer UX
- [x] user-facing manual offer / answer workflow
- [x] no signaling server required
- [x] operator fingerprint comparison
- [x] explicit trust before peer chat
- [x] two-browser / two-machine room chat path
- [x] disconnect and manual re-link
- [x] trust removal
- [ ] automatic reconnect
- [ ] optional rendezvous service

## Rung 6 — Native + LAN
- [x] Tauri v2 desktop shell scaffold
- [x] native bridge with web-safe fallback
- [x] mDNS/DNS-SD service advertisement
- [x] mDNS/DNS-SD peer browsing
- [x] real native reachability probe endpoint
- [x] resolved peer snapshot in UI
- [x] discovery remains untrusted by default
- [x] native Rust CI check + unit tests
- [ ] automatic discovery → signed link handoff
- [ ] native persistent peer identity

## Rung 7 — Direct peer files
- [x] signed file offer
- [x] explicit remote accept / reject
- [x] 25 MiB receive bound
- [x] 12 KiB signed chunking
- [x] RTCDataChannel bufferedAmount backpressure
- [x] declared-size validation
- [x] final SHA-256 verification before admission
- [x] success / failure receipt
- [x] governed REMOTE_PEER file.attach admission
- [x] bounded local blob storage
- [x] transfer progress UI
- [ ] incremental hash-state persistence
- [ ] resumable transfer offsets
- [ ] reconnect/resume lifecycle

## Rung 8 — Native link handoff
- [ ] discovery → signed link bootstrap
- [ ] native persistent peer identity
- [ ] optional reconnect policy
- [ ] optional rendezvous service with explicit privacy mode

## Later
- [ ] voice/video/screen share
- [ ] conference rooms
- [ ] synchronized media rooms
- [ ] plugins
- [ ] federation
