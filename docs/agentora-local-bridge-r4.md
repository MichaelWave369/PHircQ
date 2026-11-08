# PHircQ R4: optional live local bridge to Agentora

**Local peer-to-peer advisory communication, not autonomous execution.** This extends R2's signed `agent.exchange` messages and R3's original signed-frame bundle export.

## Using it

1. In Agentora, launch the explicit operator-started `agent_exchange_local_http` server bound to `127.0.0.1:38771`. It requires a private 64-hex bearer token file and operator-pinned PHircQ peer trust policy (see Agentora R4 documentation).
2. Open PHircQ locally, via `http://localhost:3690` for Vite development or your trusted Tauri shell. The bridge client rejects public, LAN IP, and remote web origins.
3. In **Net > Agentora Local Bridge**, choose **Enable agent handoff for next trusted Paper Link connection**. Enter `http://127.0.0.1:38771`, the token and the exact `localAgentId` / `remoteAgentId` values from your trusted policy. A token stays in React session memory and is cleared when the link disconnects or is reset; it is not saved into PHircQ snapshots, rooms, logs or localStorage.
4. Trust the remote PHircQ identity by comparing its fingerprint and establish your signed Paper Link. The agent exchange must be enabled **before** connecting, so its peer ID and agent ID binding is fixed when the link is created. It is off by default.
5. The **Send signed work offer** button creates a 10-minute `offer_work` advisory envelope and transmits it over the trusted peer link. A receiver may independently forward the actual signed frame to Agentora's local endpoint. Delivery to a peer is not a receipt from Agentora.
6. **Read Agentora review inbox** retrieves token-protected, read-only pending messages for the configured local agent. No accept/merge or tool buttons exist.

## Security

The client accepts only `http://127.0.0.1:<port>` and a 64-character lowercase hexadecimal token. It never uses browser credentials or redirects, and it refuses public/LAN-loaded PHircQ origins. Agentora must be started with an exact allowed CORS origin: `http://localhost:3690` in dev, or e.g. `http://tauri.localhost` on Windows. No wildcard origins.

The PHircQ callback forwards an **original signed frame**, not arbitrary chat text. Agentora independently verifies its ECDSA P-256 signature, peer fingerprint, agent mapping, expiry and replay before storing the pending item. All messages are advisory-only; neither sending nor reading an offer grants access to context, tools, model execution, GitHub or merge permissions.

## Still intentionally not included

Automatic launch or installation of Agentora; public PhiMadaPrime/PhiOS dashboard; background worker scheduling; unattended approval or autonomous merging. An operator must set up the peer identity trust, token and local server. This is the smallest end-to-end authenticated localhost step to pave the way for a future first-class PhiOS local service.

Tests: `npm test` and `npm run build`, plus existing signed chat and file-transfer regression checks.
