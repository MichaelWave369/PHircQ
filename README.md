# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.7 direct peer files

PHircQ can now move file bytes across an already trusted Paper Link session.

### Working

- local rooms, text chat and IRC-style commands
- capability-gated Action Bus and activity ledger
- packaged SQLite persistence
- local governed attachments with SHA-256 receipts
- local Ollama agents through a provider-neutral AgentAdapter
- signed WebRTC peer chat
- ECDSA P-256 peer identities and SHA-256 fingerprints
- replay rejection and explicit persisted trust
- Paper Link manual two-client negotiation
- Tauri v2 desktop shell
- native mDNS/DNS-SD discovery and real reachability probes
- **direct signed peer file offers**
- **explicit remote accept / reject before bytes move**
- **12 KiB chunked transfer**
- **RTCDataChannel backpressure drain**
- **declared-size enforcement**
- **final SHA-256 verification before storage admission**
- **receiver receipt back to sender**
- governed REMOTE_PEER file admission through `SEND_FILE`

### Peer file flow

```text
trusted connected peer
  ↓
signed file.offer
  ↓
operator Accept / Reject
  ↓ accepted only
chunked signed file.chunk frames
  ↓
RTCDataChannel backpressure
  ↓
declared-size validation
  ↓
SHA-256 re-computation
  ↓
bounded BlobStore
  ↓
REMOTE_PEER → file.attach → Authority
  ↓
room attachment + ledger
  ↓
signed success/failure receipt
```

A sender cannot start moving file chunks until the receiver explicitly accepts
the offer. A successfully transported blob is not admitted to PHircQ storage
until its byte count and SHA-256 match the signed offer.

### Limits

Current direct peer file limit is **25 MiB per file**. The transfer uses 12 KiB
chunks so signed JSON frames stay comfortably below common RTCDataChannel
message-size trouble zones.

The v0.7 transfer verifies SHA-256 after bounded reassembly. True incremental
hash-state persistence and transfer resume are still future work, rather than
being advertised because a progress bar looked convincing. Humanity has tried
that product-management technique enough times.

### Native desktop

```bash
npm install
npm run tauri:dev
```

Web mode remains available:

```bash
npm run dev
```

### Verify

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

See [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).

## License

MIT.
