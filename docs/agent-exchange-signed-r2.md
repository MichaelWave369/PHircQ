# Signed agent-exchange gate (R2)

The Commonline advisory exchange is now an **opt-in typed payload** of PHircQ PeerSession, not a separate unverified network transport.

A signed frame is verified with ECDSA P-256 and must match persisted peer key trust before the new agent.exchange kind can be delivered. Enabling agent delivery additionally requires an explicit local AgentExchangeBinding containing localAgentId, remoteAgentId, remotePeerId, maySend and mayReceive callbacks. This binding comes from trusted operator configuration, not from peer discovery, the signed frame, or room text.

Outbound sends validate Commonline's bounded v1 envelope, both agent IDs, remote peer trust, and maySend. Inbound delivery validates the frame signature, peer fingerprint, signed sender peer ID, configured sender/recipient agent mapping, and mayReceive before invoking onAgentExchange. No handler or no binding means rejection. No implied room history access, worker dispatch, GitHub mutation, or merge authority.

## Limitations

- This adds an optional signed path through PHircQ's existing PeerSession. It does **not** by itself authenticate the operator who configures AgentExchangeBinding.
- PHircQ's per-process replay window blocks duplicate signed frame IDs, but re-signed duplicate message IDs require Agentora's separate durable inbox dedupe ledger.
- Receiver onAgentExchange must persist into a governed inbox and should not treat the message as executable instructions.
- No direct Commonline room service, Agentora HTTP bridge, or cross-process deployment is introduced here. A production wiring layer must map authenticated peer IDs to agent identities and grant scopes.
- No automatic enablement. PHircQ user-facing chat/file functionality remains unchanged.

Verify with npm test and npm run build; existing signed-chat and file-transfer tests must continue to pass.
