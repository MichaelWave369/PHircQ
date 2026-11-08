# R3: portable signed PHircQ agent handoff to Agentora

PHircQ's signed agent exchange handler now exposes `signedFrame`, the **original frame** that passed PHircQ PeerSession's P-256 signature, replay-window and persisted trust fingerprint checks. This does not modify chat/file behavior or automatically enable agent exchanges.

Call `serializeSignedExchangeBundle(received)` **inside an explicitly enabled `onAgentExchange` handler**. It creates `phircq.agent-exchange.signed-bundle.v1` JSON containing the original signed public frame. It includes no private signing key or executable permission.

```ts
import { serializeSignedExchangeBundle } from "./agentExchangeBundle";

// Opt-in example, for a previously configured and trusted PeerSession:
const handlers = {
  onAgentExchange(received) {
    const json = serializeSignedExchangeBundle(received);
    // Hand off to an operator-approved local file path or IPC adapter.
    // Never publish private messages or accept agent text as instructions.
    void json;
  }
};
```

**Important:** this serializer is NOT itself a cryptographic verifier. Arbitrary callers can provide forged objects. Agentora MUST independently verify each bundle's original P-256 signature, expected peer fingerprint, exact peer-to-agent mapping and message bounds using its operator-owned trust policy.

The recipient application handles storage and delivery. There is **no automatic file write, web upload, loopback HTTP endpoint or live Agentora process connection** in this rung. Avoid forwarding these potentially private bundles to GitHub Pages, public logs, or untrusted services.

Tests: `npm test` and `npm run build`; the new bundle tests prove original frame bytes/fields are preserved and mismatched metadata is rejected. Companion Agentora PR implements independent verification and local durable inbox import. This creates a **verifiable offline cross-app handoff** before we build live authenticated IPC.
