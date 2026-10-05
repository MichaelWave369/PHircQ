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

## Core rules

- Humans, agents, bots, services and remote peers use one Actor model.
- Meaningful operations pass through the Action Bus.
- Authority is explicit and inspectable.
- Local operation does not require an account or cloud backend.
- Transport never grants authority.
- Discovery never grants trust.
- Feature status distinguishes WORKING from future work.

## Persistence boundary

The browser shell uses packaged `sql.js` for SQLite semantics. Attachment bytes
live in a bounded IndexedDB BlobStore while metadata and ledger state live in
SQLite. The native shell can later replace those backing stores without changing
the runtime contract.

## Agent boundary

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

## Peer trust boundary

```text
Transport
  ↓
SignedFrame verification
  ↓
ReplayWindow
  ↓
persisted fingerprint trust
  ↓
REMOTE_PEER Actor
  ↓
Action Bus
  ↓
Room / File service
  ↓
Ledger
```

Peer frames use ECDSA P-256 signatures. Public keys are fingerprinted with
SHA-256. A cryptographically valid frame from an unknown key is still untrusted.

## Native LAN boundary

The Tauri app advertises and browses `_phircq._tcp.local.`. A native reachability
probe proves that a resolved endpoint is actually speaking the versioned PHircQ
probe protocol. Neither mDNS metadata nor a successful probe is accepted as
cryptographic identity.

## Direct peer file protocol

File transfer reuses the already authenticated PeerSession and signed-frame
path.

Control frames:

```text
file.offer
file.accept
file.reject
file.complete
file.receipt
```

Data frames:

```text
file.chunk
  transferId
  index
  base64 bytes
```

Each offer freezes:

```text
transfer id
room
display name
filename
MIME type
byte size
SHA-256
chunk size
chunk count
```

The receiver validates the offer before presenting it. No chunk is accepted
until the operator accepts that transfer id.

The sender waits on the transport `drain()` contract while the RTCDataChannel
buffer is above the configured threshold. This provides actual browser
backpressure rather than simply adding a progress bar to a memory explosion.

The receiver enforces:

- transfer must be from an already trusted peer
- offer must be explicitly accepted
- filename must be safe and bounded
- total size must be at or below 25 MiB
- chunk index and byte length must match the negotiated layout
- received byte count must equal the declared size
- final SHA-256 must equal the signed offer hash
- local BlobStore must accept the bytes
- REMOTE_PEER must pass `SEND_FILE` through the Action Bus

Only after those checks does the attachment appear in room history. The receiver
then signs a success or failure receipt back to the sender.

Current v0.7 hashing is final SHA-256 after bounded reassembly. Incremental hash
state, persistent offsets and resume negotiation remain intentionally separate
future work.
