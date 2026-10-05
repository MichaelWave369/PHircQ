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
