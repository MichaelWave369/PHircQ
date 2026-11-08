# Commonline agent exchange pilot: PHircQ

This rung establishes a **local, in-memory, two-agent** message exchange. It intentionally does not open a network port or advertise a new remote-message privilege.

The **commonline.agent-exchange.v1** envelope matches the Commonline protocol sidecar. It has a schema marker, message/thread IDs, sender, recipient, kind, canonical UTC times, bounded summary, optional opaque contextRef and optional sourceSha, and a hardcoded authority value of **advisory-only**.

The PHircQ adapter accepts ONLY MemoryTransport instances. Tests demonstrate a BTM agent offering work to OverStrings, an outcome reply, and rejection of duplicate, impersonated, wrong-recipient, expired, forged-authority and disconnected messages. This does not certify real peer identity.

## Production integration gate

Do not wire raw WebRtcTransport into this helper. Real network delivery must traverse PHircQ's existing signed PeerSession (ECDSA P-256 / persisted trust), reject replays durably, authenticate actor-to-agent bindings, check permitted contact paths and context disclosure, and pass relevant message operations through the capability-gated Action Bus. An incoming envelope is data; it never grants SEND_MESSAGE, INVOKE_AGENT, repository edits, PR merge, or tool execution. PHircQ cannot infer Commonline room membership or attention leases from peer transport connectivity.

Commonline owns work/room authority, Agentora owns orchestration, AgentCeption owns governed execution, and PhiMadaPrime remains read-only. This module is a first interoperability fixture, **not a shipped federation or a live agent service**.
