import { describe, expect, it } from "vitest";
import {
  createPeerIdentity,
  fingerprintPublicKey,
  ReplayWindow,
  signFrame,
  verifyFrame
} from "./peerCrypto";

describe("peer crypto", () => {
  it("signs and verifies a frame with an exported public identity", async () => {
    const identity = await createPeerIdentity("peer-a");
    const frame = await signFrame(identity, {
      kind: "chat.message",
      text: "hello"
    });

    expect(await verifyFrame(frame)).toBe(true);
    expect(await fingerprintPublicKey(frame.publicKey)).toBe(identity.fingerprint);
    expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects tampered payloads", async () => {
    const identity = await createPeerIdentity("peer-a");
    const frame = await signFrame(identity, { text: "original" });

    const tampered = {
      ...frame,
      payload: { text: "tampered" }
    };

    expect(await verifyFrame(tampered)).toBe(false);
  });

  it("rejects duplicate frame ids in the replay window", () => {
    const replay = new ReplayWindow(2);

    expect(replay.accept("a")).toBe(true);
    expect(replay.accept("a")).toBe(false);
    expect(replay.accept("b")).toBe(true);
    expect(replay.accept("c")).toBe(true);
    expect(replay.accept("a")).toBe(true);
  });
});
