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

The v0.1 rung intentionally implements only the local contract. Later networking
must preserve the same Action Bus and authority boundary rather than bypass it.
