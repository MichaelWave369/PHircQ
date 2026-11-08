import { describe, expect, it } from "vitest";
import { PeerSession } from "./peerSession";
import { createPeerIdentity, signFrame } from "./peerCrypto";
import { createMemoryTransportPair } from "./transport";
import { EXCHANGE_SCHEMA } from "./agentExchange";

const envelope = () => ({
  schema: EXCHANGE_SCHEMA,
  messageId: "btm-to-overstrings-201",
  threadId: "tracking-issue-201",
  sender: "agent:btm",
  recipient: "agent:overstrings",
  kind: "offer_work",
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  summary: "Please review the hand-tracking regression.",
  authority: "advisory-only"
});

describe("signed agent exchange bridge", () => {
  it("delivers an advisory message ONLY across authenticated, trusted and allowed peer binding", async () => {
    const [a, b] = createMemoryTransportPair();
    const identityA = await createPeerIdentity("peer-a");
    const identityB = await createPeerIdentity("peer-b");
    const inbox = new Promise<{ peerId: string; kind: string }>((resolve) => {
      // resolved by the receiver below
      deliver = resolve;
    });
    let deliver!: (value: { peerId: string; kind: string }) => void;
    const left = await PeerSession.create({
      peerId: "peer-a", identity: identityA, transport: a,
      trusts: () => [{ peerId: "peer-b", displayName: "B", fingerprint: identityB.fingerprint, trustedAt: "" }],
      agentExchange: {
        localAgentId: "agent:btm", remoteAgentId: "agent:overstrings",
        remotePeerId: "peer-b", maySend: () => true, mayReceive: () => true
      }
    });
    const right = await PeerSession.create({
      peerId: "peer-b", identity: identityB, transport: b,
      trusts: () => [{ peerId: "peer-a", displayName: "A", fingerprint: identityA.fingerprint, trustedAt: "" }],
      agentExchange: {
        localAgentId: "agent:overstrings", remoteAgentId: "agent:btm",
        remotePeerId: "peer-a", maySend: () => true, mayReceive: () => true
      },
      handlers: {
        onAgentExchange(message) {
          deliver({ peerId: message.peerId, kind: message.message.kind });
        }
      }
    });
    await Promise.all([left.connect(), right.connect()]);
    await left.sendAgentExchange(envelope());
    await expect(inbox).resolves.toEqual({ peerId: "peer-a", kind: "offer_work" });
    await Promise.all([left.disconnect(), right.disconnect()]);
  });

  it("rejects forged claimed agent identity even when the peer signature is genuine", async () => {
    const [a, b] = createMemoryTransportPair();
    const identityA = await createPeerIdentity("peer-a");
    const identityB = await createPeerIdentity("peer-b");
    let rejected!: (reason: string) => void;
    const reject = new Promise<string>((resolve) => { rejected = resolve; });
    const right = await PeerSession.create({
      peerId: "peer-b", identity: identityB, transport: b,
      trusts: () => [{ peerId: "peer-a", displayName: "A", fingerprint: identityA.fingerprint, trustedAt: "" }],
      agentExchange: {
        localAgentId: "agent:overstrings", remoteAgentId: "agent:btm",
        remotePeerId: "peer-a", maySend: () => true, mayReceive: () => true
      },
      handlers: {
        onRejected(reason) { rejected(reason); },
        onAgentExchange() { throw new Error("must not reach inbox"); }
      }
    });
    await a.connect(); await right.connect();
    const frame = await signFrame(identityA, {
      kind: "agent.exchange", message: { ...envelope(), sender: "agent:intruder" }
    });
    await a.send({ type: "peer.signed-frame", payload: frame });
    await expect(reject).resolves.toMatch(/identity or policy rejected/);
    await right.disconnect(); await a.disconnect();
  });

  it("requires an explicit outgoing contact grant, never mere transport connectivity", async () => {
    const [a, b] = createMemoryTransportPair();
    const identityA = await createPeerIdentity("peer-a");
    const identityB = await createPeerIdentity("peer-b");
    const left = await PeerSession.create({
      peerId: "peer-a", identity: identityA, transport: a,
      trusts: () => [{ peerId: "peer-b", displayName: "B", fingerprint: identityB.fingerprint, trustedAt: "" }],
      agentExchange: {
        localAgentId: "agent:btm", remoteAgentId: "agent:overstrings",
        remotePeerId: "peer-b", maySend: () => false, mayReceive: () => true
      }
    });
    await a.connect(); await b.connect();
    await expect(left.sendAgentExchange(envelope())).rejects.toThrow("policy denied outbound");
    await expect(left.sendAgentExchange({ ...envelope(), authority: "execute" })).rejects.toThrow();
    await left.disconnect(); await b.disconnect();
  });

  it("will not deliver signed exchange data when persisted peer trust is absent", async () => {
    const [a, b] = createMemoryTransportPair();
    const identityA = await createPeerIdentity("peer-a");
    const identityB = await createPeerIdentity("peer-b");
    let untrusted!: () => void;
    const seenUntrusted = new Promise<void>((resolve) => { untrusted = resolve; });
    const right = await PeerSession.create({
      peerId: "peer-b", identity: identityB, transport: b, trusts: () => [],
      agentExchange: {
        localAgentId: "agent:overstrings", remoteAgentId: "agent:btm",
        remotePeerId: "peer-a", maySend: () => true, mayReceive: () => true
      },
      handlers: {
        onUntrustedPeer() { untrusted(); },
        onAgentExchange() { throw new Error("untrusted frame delivered"); }
      }
    });
    await a.connect(); await right.connect();
    await a.send({ type: "peer.signed-frame", payload: await signFrame(identityA, {
      kind: "agent.exchange", message: envelope()
    }) });
    await seenUntrusted;
    await right.disconnect(); await a.disconnect();
  });
});
