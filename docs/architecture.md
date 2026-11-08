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

- Transport does not grant authority.
- Discovery does not grant trust.
- A valid signature from an unknown key is still untrusted.
- File bytes do not move before receiver acceptance.
- Feature status must distinguish implemented work from planned work.

## Persistent peer identity

The browser/webview identity vault stores an exportable P-256 public/private JWK
pair plus the stable PHircQ peer id in IndexedDB.

On startup:

```text
identity vault
  ↓
import P-256 keypair
  ↓
recompute SHA-256 public-key fingerprint
  ↓
stable PeerIdentity
```

Paper Link reuses that identity instead of generating a new key for every
negotiation. Native mDNS also advertises the same stable peer id.

The current private-key storage is application persistence, not an OS secure
keystore. That distinction is intentional and documented.

## Native LAN signaling

The native probe endpoint now carries two independent protocols on the same
verified local socket:

```text
phircq.native-probe.v1
phircq.lan-link.v1
```

The probe hello is always read first. The sender verifies that the hello peer id
matches the mDNS-resolved peer before sending a link envelope.

A link envelope contains:

```text
schema
kind = offer | answer
fromPeerId
toPeerId
signal
```

The Rust service accepts only bounded envelopes addressed to its currently
advertised persistent peer id and stores them in a small in-memory inbox. The
frontend drains that inbox and feeds the signal into the existing Paper Link
state machine.

## LAN handoff trust boundary

```text
mDNS discovery
  ↓
verified native hello
  ↓
offer / answer exchange
  ↓
Paper Link remote public key
  ↓
operator compares fingerprint
  ↓
persisted trust
  ↓
signed PeerSession
  ↓
Action Bus
```

No step before the explicit fingerprint trust action creates authority.

## Direct peer files

Direct file transfers continue to reuse the signed PeerSession. Offers must be
accepted, chunks are bounded, WebRTC backpressure is observed, the receiver
recomputes SHA-256 before storage admission, and REMOTE_PEER still requires
SEND_FILE through the Action Bus.
