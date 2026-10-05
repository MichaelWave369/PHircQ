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

A later native persistence rung can replace these backing stores without
changing the runtime contract.

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

## Peer boundary

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

Discovery never sits inside that trust chain. Finding a device on the LAN does
not make it trusted.

## Native shell boundary

The Tauri shell adds native capabilities behind an explicit bridge:

```text
React UI
  ↓
nativeBridge.ts
  ↓ only when __TAURI_INTERNALS__ exists
Tauri invoke command
  ↓
Rust native service
```

The ordinary browser build does not emulate or invent native results.

## Native LAN discovery

The desktop app advertises and browses the DNS-SD service:

```text
_phircq._tcp.local.
```

A discovered record contains non-authoritative discovery metadata such as a
peer id, display name and PHircQ version. That metadata is useful for finding a
nearby node but is **not** used as cryptographic trust evidence.

Each native process also opens a real ephemeral TCP probe listener. The exact
listener port is placed in the mDNS SRV record. A probe response contains:

```text
schema = phircq.native-probe.v1
peer_id
display_name
version
```

The client verifies that the probe's peer id matches the mDNS peer id before
reporting the node as reachable.

Current discovery flow:

```text
mDNS resolve
  ↓
UNTRUSTED nearby node
  ↓
optional native reachability probe
  ↓
operator still uses signed/fingerprint trust path
```

The next native networking rung can automate the handoff into signed linking,
but it must preserve the same explicit trust boundary rather than treating mDNS
as identity.
