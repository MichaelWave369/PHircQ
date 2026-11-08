# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.8 persistent identity + LAN link handoff

PHircQ now preserves a stable local signing identity across app reloads and can
move the Paper Link offer/answer exchange directly over the verified native LAN
endpoint.

### Working

- local rooms, text chat and IRC-style commands
- SQLite-backed runtime state
- governed local attachments
- local Ollama agents
- signed WebRTC peer chat
- explicit peer fingerprint trust
- direct peer files with accept/reject, backpressure and SHA-256 verification
- Tauri desktop shell
- native mDNS/DNS-SD discovery
- native reachability probe
- **persistent ECDSA P-256 peer identity in the app's IndexedDB/webview vault**
- **stable peer id and fingerprint across normal reloads**
- **native LAN offer/answer signal exchange**
- **discovered peer → secure Paper Link handoff**
- **no cloud signaling service required for same-LAN handoff**
- **fingerprint trust is still explicit after negotiation**

### LAN secure-link flow

```text
mDNS discovers PHircQ node
  ↓
native probe verifies endpoint + peer id
  ↓
operator clicks Secure LAN link
  ↓
Paper Link offer sent over local TCP signal endpoint
  ↓
remote PHircQ creates answer
  ↓
answer returned over verified local endpoint
  ↓
both clients display persistent fingerprints
  ↓
operator explicitly trusts fingerprint
  ↓
RTCDataChannel chat/files
```

Discovery and signal delivery are **not trust**. PHircQ still refuses signed
peer traffic until the advertised cryptographic fingerprint has been explicitly
trusted.

### Identity storage truth

The v0.8 signing key is persisted as exportable P-256 JWK material inside the
app's IndexedDB/webview storage. That gives PHircQ a stable identity across
normal launches without a cloud account.

It is **not yet an OS-backed secure enclave/keychain implementation**. Moving the
private key behind Windows DPAPI, macOS Keychain, Linux Secret Service or another
native keystore remains future hardening work.

### Privacy

Strict-local WebRTC still uses:

```ts
new RTCPeerConnection({ iceServers: [] })
```

Native LAN signaling uses the discovered PHircQ TCP endpoint. PHircQ does not
silently contact a STUN, TURN or cloud rendezvous service in this mode.

### Native desktop

```bash
npm install
npm run tauri:dev
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
