# PHircQ Architecture

PHircQ is a local-first communications runtime, not merely a chat skin.

```text
Actor
  ↓
Intent
  ↓
Action Bus
  ↓
Authority
  ↓
Runtime / Service
  ↓
Event
  ↓
Ledger
  ↓
Transport
```

## Principles

- Humans, agents, bots, services and remote peers use one Actor model.
- Meaningful operations pass through the Action Bus.
- Authority is explicit and inspectable.
- Local operation does not require an account or cloud backend.
- Transport is a boundary, not UI state.
- Feature status must distinguish WORKING, EXPERIMENTAL and PLANNED.
- Remote peers, agents, scripts and files are untrusted until authorized.

## Browser persistence boundary

The current web shell uses packaged `sql.js` for SQLite semantics. The SQLite
database is serialized into browser-local storage, while attachment bytes are
kept separately in IndexedDB. No CDN is required for the SQLite WASM module.

This split is intentional:

- SQLite stores actors, rooms, memberships, messages, attachment metadata and
  ledger receipts.
- IndexedDB stores opaque attachment bytes.
- Messages refer to attachments by stable IDs.
- SHA-256 is calculated before an attachment enters the runtime.
- File attachment actions still pass through the Action Bus and authority layer.

A later Tauri rung can replace the browser backing stores with native file-based
SQLite and filesystem blobs without changing the runtime contract.

## Agent boundary

Agents are ordinary PHircQ Actors plus a persisted AgentDefinition. Providers
implement the AgentAdapter contract. The first provider is Ollama, but provider
logic is kept outside React and outside the core message model.

Agent lifecycle is governed:

```text
Operator
  ↓ MANAGE_AGENT / INVOKE_AGENT
Action Bus
  ↓
Authority
  ↓
AgentAdapter
  ↓
provider response
  ↓ SEND_MESSAGE as agent Actor
Action Bus
  ↓
Room + Ledger
```

A local model therefore does not receive filesystem, shell, camera, microphone,
network-peer or script authority merely because it can generate text. Those
capabilities must be introduced separately and explicitly.


## Transport and peer trust boundary

Transport moves opaque PHircQ events. It does not decide who is trusted and it
does not directly mutate room state.

The v0.4 peer path is:

```text
Transport
  ↓
SignedFrame verification
  ↓
ReplayWindow
  ↓
persisted peer fingerprint trust
  ↓
REMOTE_PEER Actor
  ↓ SEND_MESSAGE
Action Bus
  ↓
Authority
  ↓
Room
  ↓
Ledger
```

Peer frames use ECDSA P-256 signatures. The exported public key is fingerprinted
with SHA-256 and the fingerprint is what the operator trust record binds to the
peer id. A valid signature alone is not sufficient for admission.

The browser WebRTC acceptance harness uses `RTCPeerConnection({ iceServers: [] })`.
That proves the transport can operate without silently contacting a STUN/TURN
provider. It is an acceptance self-test, not yet a complete remote signaling UX.
