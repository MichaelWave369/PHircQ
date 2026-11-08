import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "./transport";
import { EXCHANGE_EVENT, EXCHANGE_SCHEMA, openLocalAgentExchange, readExchangeMessage } from "./agentExchange";

const now = Date.parse("2026-11-07T20:00:00.000Z");
const offer = {
  schema: EXCHANGE_SCHEMA,
  messageId: "btm-msg-001",
  threadId: "quest-tracking-001",
  sender: "agent:btm",
  recipient: "agent:overstrings",
  kind: "offer_work",
  issuedAt: "2026-11-07T19:59:00.000Z",
  expiresAt: "2026-11-07T20:59:00.000Z",
  summary: "Review a Quest hand tracking regression; no permission to edit.",
  authority: "advisory-only"
};

describe("Commonline agent exchange via PHircQ memory transport (pilot only)", () => {
  it("sends a review-only offer and a response between separate local agents", async () => {
    const [a, b] = createMemoryTransportPair();
    await Promise.all([a.connect(), b.connect()]);
    const inboxA: string[] = [], inboxB: string[] = [];
    const left = openLocalAgentExchange({
      transport: a, selfAgent: "agent:btm", allowedPeerAgent: "agent:overstrings",
      now: () => now, onMessage: (m) => inboxA.push(m.kind)
    });
    const right = openLocalAgentExchange({
      transport: b, selfAgent: "agent:overstrings", allowedPeerAgent: "agent:btm",
      now: () => now, onMessage: (m) => inboxB.push(m.kind)
    });
    await left.send(offer);
    expect(inboxB).toEqual(["offer_work"]);
    await right.send({
      ...offer, messageId: "over-msg-001", sender: offer.recipient,
      recipient: offer.sender, kind: "propose_outcome", summary: "Suggested regression reproducer."
    });
    expect(inboxA).toEqual(["propose_outcome"]);
    left.close(); right.close();
    await a.disconnect(); await b.disconnect();
  });

  it("drops replay, impersonation, wrong-recipient, expired, and forged-authority frames", async () => {
    const [a, b] = createMemoryTransportPair();
    await Promise.all([a.connect(), b.connect()]);
    const received: string[] = [];
    const right = openLocalAgentExchange({
      transport: b, selfAgent: "agent:overstrings", allowedPeerAgent: "agent:btm",
      now: () => now, onMessage: (m) => received.push(m.messageId)
    });
    for (const payload of [
      offer, offer,
      { ...offer, messageId: "spoof", sender: "agent:intruder" },
      { ...offer, messageId: "wrong", recipient: "agent:other" },
      { ...offer, messageId: "stale", expiresAt: "2026-11-07T19:59:30.000Z" },
      { ...offer, messageId: "grant", authority: "execute" }
    ]) await a.send({ type: EXCHANGE_EVENT, payload });
    expect(received).toEqual(["btm-msg-001"]);
    expect(() => readExchangeMessage({ ...offer, mergeAuthorized: true }, now)).toThrow();
    right.close();
    await a.disconnect(); await b.disconnect();
  });

  it("rejects attempted outbound impersonation and transport disconnect", async () => {
    const [a, b] = createMemoryTransportPair();
    await Promise.all([a.connect(), b.connect()]);
    const left = openLocalAgentExchange({
      transport: a, selfAgent: "agent:btm", allowedPeerAgent: "agent:overstrings",
      now: () => now, onMessage: () => {}
    });
    await expect(left.send({ ...offer, sender: "agent:other" })).rejects.toThrow("ROUTE_DENIED");
    await b.disconnect();
    await expect(left.send(offer)).rejects.toThrow("Peer transport is not connected");
    left.close(); await a.disconnect();
  });
});
