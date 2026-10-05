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
- [x] persisted agent definitions
- [x] MANAGE_AGENT / INVOKE_AGENT authority
- [x] governed agent room participation

## Rung 4 — Transport core
- [x] formal Transport contract
- [x] WebRTC RTCDataChannel transport
- [x] signed frames
- [x] explicit peer trust
- [x] replay rejection
- [x] governed REMOTE_PEER message admission

## Rung 5 — Paper Link
- [x] manual offer / answer workflow
- [x] fingerprint comparison
- [x] explicit trust before chat
- [x] two-client room chat
- [x] disconnect / re-link
- [x] trust removal

## Rung 6 — Native + LAN
- [x] Tauri v2 shell
- [x] native bridge
- [x] mDNS advertisement and browsing
- [x] native reachability probe
- [x] native Rust CI

## Rung 7 — Direct peer files
- [x] signed file offer
- [x] explicit accept / reject
- [x] bounded chunking
- [x] RTCDataChannel backpressure
- [x] declared-size validation
- [x] final SHA-256 verification
- [x] governed file admission
- [x] sender receipt

## Rung 8 — Persistent identity + LAN handoff
- [x] persistent P-256 identity across normal reloads
- [x] stable peer id and fingerprint
- [x] mDNS advertises the persistent peer id
- [x] native versioned LAN link envelope
- [x] verified endpoint offer delivery
- [x] verified endpoint answer delivery
- [x] discovery → Paper Link negotiation handoff
- [x] explicit fingerprint trust retained
- [x] manual Paper Link remains fallback
- [ ] OS-backed native private-key vault
- [ ] automatic reconnect policy

## Rung 9 — Resumable data plane
- [ ] persistent transfer manifest
- [ ] chunk acknowledgement bitmap
- [ ] resume offsets after reconnect
- [ ] incremental hash-state persistence
- [ ] transfer cancellation and expiry

## Later
- [ ] optional Internet rendezvous mode
- [ ] voice/video/screen share
- [ ] conference rooms
- [ ] synchronized media rooms
- [ ] plugins
- [ ] federation
