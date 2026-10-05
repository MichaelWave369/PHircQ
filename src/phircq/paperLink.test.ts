import { describe, expect, it } from "vitest";
import {
  decodePaperSignal,
  encodePaperSignal,
  PAPER_SIGNAL_SCHEMA,
  type PaperSignal
} from "./paperLink";
import { createPeerIdentity } from "./peerCrypto";

describe("Paper Link signals", () => {
  it("round-trips a fingerprint-bound manual signal", async () => {
    const identity = await createPeerIdentity("peer-test");
    const signal: PaperSignal = {
      schema: PAPER_SIGNAL_SCHEMA,
      kind: "offer",
      sessionId: "session-test",
      from: {
        peerId: identity.peerId,
        displayName: "TestPeer",
        publicKey: identity.publicKey,
        fingerprint: identity.fingerprint
      },
      description: {
        type: "offer",
        sdp: "v=0"
      }
    };

    await expect(
      decodePaperSignal(encodePaperSignal(signal), "offer")
    ).resolves.toEqual(signal);
  });

  it("rejects a tampered fingerprint", async () => {
    const identity = await createPeerIdentity("peer-test");
    const signal: PaperSignal = {
      schema: PAPER_SIGNAL_SCHEMA,
      kind: "answer",
      sessionId: "session-test",
      from: {
        peerId: identity.peerId,
        displayName: "TestPeer",
        publicKey: identity.publicKey,
        fingerprint: "0".repeat(64)
      },
      description: {
        type: "answer",
        sdp: "v=0"
      }
    };

    await expect(
      decodePaperSignal(encodePaperSignal(signal), "answer")
    ).rejects.toThrow("fingerprint");
  });

  it("rejects offer/answer kind confusion", async () => {
    const identity = await createPeerIdentity("peer-test");
    const signal: PaperSignal = {
      schema: PAPER_SIGNAL_SCHEMA,
      kind: "offer",
      sessionId: "session-test",
      from: {
        peerId: identity.peerId,
        displayName: "TestPeer",
        publicKey: identity.publicKey,
        fingerprint: identity.fingerprint
      },
      description: {
        type: "offer",
        sdp: "v=0"
      }
    };

    await expect(
      decodePaperSignal(encodePaperSignal(signal), "answer")
    ).rejects.toThrow("Expected a Paper Link answer");
  });
});
