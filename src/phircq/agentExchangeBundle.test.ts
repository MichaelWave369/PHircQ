import { describe, expect, it } from "vitest";
import { createPeerIdentity, signFrame } from "./peerCrypto";
import {
  SIGNED_EXCHANGE_BUNDLE_SCHEMA,
  serializeSignedExchangeBundle
} from "./agentExchangeBundle";
import { EXCHANGE_SCHEMA, readExchangeMessage } from "./agentExchange";

const message = () => ({
  schema: EXCHANGE_SCHEMA,
  messageId: "btm-quest-current",
  threadId: "tracking-current",
  sender: "agent:btm",
  recipient: "agent:overstrings",
  kind: "offer_work",
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  summary: "Review Quest hand tracking regression.",
  authority: "advisory-only"
});

describe("portable signed exchange handoff", () => {
  it("preserves the actual signed P-256 peer frame for Agentora verification", async () => {
    const identity = await createPeerIdentity("peer-btm");
    const envelope = readExchangeMessage(message());
    const signedFrame = await signFrame(identity, {
      kind: "agent.exchange" as const,
      message: envelope
    });
    const serialized = serializeSignedExchangeBundle({
      peerId: "peer-btm", frameId: signedFrame.id,
      fingerprint: identity.fingerprint, message: envelope, signedFrame
    });
    const bundle = JSON.parse(serialized);
    expect(bundle.schema).toBe(SIGNED_EXCHANGE_BUNDLE_SCHEMA);
    expect(bundle.frame).toEqual(signedFrame);
    expect(bundle.frame.publicKey).not.toHaveProperty("d");
  });

  it("rejects mismatched claimed peer, frame ID, and message", async () => {
    const identity = await createPeerIdentity("peer-btm");
    const envelope = readExchangeMessage(message());
    const signedFrame = await signFrame(identity, {
      kind: "agent.exchange" as const, message: envelope
    });
    const received = {
      peerId: "peer-btm", frameId: signedFrame.id,
      fingerprint: identity.fingerprint, message: envelope, signedFrame
    };
    expect(() => serializeSignedExchangeBundle({
      ...received, peerId: "peer-intruder"
    })).toThrow(/identity/);
    expect(() => serializeSignedExchangeBundle({
      ...received, frameId: "wrong"
    })).toThrow(/identity/);
    expect(() => serializeSignedExchangeBundle({
      ...received, message: { ...envelope, summary: "changed" }
    })).toThrow(/disagree/);
  });
});
