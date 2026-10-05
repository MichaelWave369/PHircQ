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

The web shell uses packaged `sql.js` for SQLite semantics. The SQLite database
is serialized into browser-local storage, while attachment bytes are kept
separately in IndexedDB.

- SQLite stores actors, rooms, memberships, messages, attachment metadata,
  agent definitions, peer trust and ledger receipts.
- IndexedDB stores opaque attachment bytes.
- Messages refer to attachments by stable IDs.
- SHA-256 is calculated before an attachment enters the runtime.
- File attachment actions still pass through the Action Bus and authority layer.

A later Tauri rung can replace the browser backing stores with native file-based
SQLite and filesystem blobs without changing the runtime contract.

## Agent boundary

Agents are ordinary PHircQ Actors plus a persisted AgentDefinition. Providers
implement the AgentAdapter contract.

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

A local model does not receive filesystem, shell, camera, microphone,
network-peer or script authority merely because it can generate text.

## Transport and peer trust boundary

Transport moves opaque PHircQ events. It does not decide who is trusted and it
does not directly mutate room state.

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
peer id. A valid signature alone is not enough for admission.

## Paper Link signaling boundary

Paper Link separates **connection setup** from **chat trust**.

The manual offer/answer bundle contains:

```text
schema
session id
offer or answer SDP
peer id
display name
public verification key
SHA-256 fingerprint
```

PHircQ validates that the advertised fingerprint matches the included public
key before accepting the bundle. The operator still has to compare and trust
the remote fingerprint explicitly before signed room chat is admitted.

The strict-local peer connection is created with `iceServers: []`. No STUN or
TURN provider is contacted by PHircQ in this mode. Because there is no relay,
cross-NAT Internet reachability is not guaranteed.

The current re-link lifecycle is intentionally explicit:

```text
disconnect
  ↓
close RTCDataChannel + RTCPeerConnection
  ↓
make fresh offer
  ↓
fresh session
  ↓
reuse or re-confirm persisted trust
```

Automatic reconnect and an optional rendezvous layer remain separate future
capabilities so they cannot quietly erode the strict-local guarantee.
