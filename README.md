# PHircQ

**PHircQ = Φ + mIRC + ICQ**

PHircQ is a local-first communications runtime for humans, agents, files,
media and governed automation.

```text
Actor → Intent → Action Bus → Authority → Runtime → Event → Ledger → Transport
```

## v0.5 Paper Link rung

### Working

- local identity, rooms, text chat and IRC-style commands
- capability-gated Action Bus and inspectable ledger
- packaged SQLite persistence
- governed local attachments with SHA-256 receipts
- provider-neutral AgentAdapter and local Ollama agents
- formal Transport interface
- WebRTC RTCDataChannel transport
- ECDSA P-256 signed peer frames
- SHA-256 public-key fingerprints
- explicit persisted peer trust and trust removal
- replay / duplicate frame rejection
- governed REMOTE_PEER message admission
- strict-local WebRTC self-test with no external ICE servers
- **Paper Link** manual offer/answer workflow
- fingerprint comparison before trust
- two-browser/two-machine signed peer chat
- disconnect and manual re-link lifecycle

### Paper Link

Paper Link deliberately uses no signaling server.

1. Client A chooses **Make offer**.
2. A copies its signal to Client B.
3. B pastes the offer and chooses **Answer pasted offer**.
4. B copies the answer back to A.
5. A pastes it and chooses **Apply pasted answer**.
6. Both operators compare the displayed SHA-256 identity fingerprints.
7. Each side explicitly trusts the other fingerprint.
8. Both choose **Connect chat**.
9. Messages sent through Paper Link enter the normal PHircQ room and ledger path.

The signal is intentionally plain JSON so it can be inspected, copied through
another messenger, saved to a file, read over a call, or moved however the
operators choose. Humanity has reinvented exchanging phone numbers, except now
the phone number contains SDP and a public key.

### Privacy and security truth

The strict-local Paper Link configuration uses:

```ts
new RTCPeerConnection({ iceServers: [] })
```

PHircQ therefore does not silently contact a STUN or TURN service in this mode.
That also means strict-local links are primarily useful where direct ICE
connectivity exists, commonly on the same LAN. Cross-NAT Internet connectivity
is **not** claimed in this rung.

WebRTC RTCDataChannel supplies encrypted transport. PHircQ's ECDSA signatures
add application-level identity/provenance and replay checking. The signatures
are not themselves encryption.

### Still planned

- rendezvous / optional signaling service
- automatic reconnect
- native Tauri shell
- mDNS LAN discovery
- direct peer file transfer
- voice/video/screen share
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
