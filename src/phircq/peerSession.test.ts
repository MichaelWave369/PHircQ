import { describe, expect, it } from "vitest";
import { PeerSession } from "./peerSession";
import { ClientRuntime } from "./runtime";
import { MemoryStore } from "./store";
import { createMemoryTransportPair } from "./transport";

describe("peer session", () => {
  it("moves signed chat between two independent runtimes only after explicit trust", async () => {
    const runtimeA = new ClientRuntime(new MemoryStore());
    const runtimeB = new ClientRuntime(new MemoryStore());
    runtimeA.submit("/nick Mikey");
    runtimeB.submit("/nick TestPeer");

    const [transportA, transportB] = createMemoryTransportPair();

    let resolveReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    const sessionA = await PeerSession.create({
      peerId: "peer-a",
      transport: transportA,
      trusts: () => runtimeA.state.peers
    });

    const sessionB = await PeerSession.create({
      peerId: "peer-b",
      transport: transportB,
      trusts: () => runtimeB.state.peers,
      handlers: {
        onChat(message) {
          runtimeB.receivePeerChat(message);
          resolveReceived();
        }
      }
    });

    runtimeA.trustPeer({
      peerId: "peer-b",
      displayName: "TestPeer",
      fingerprint: sessionB.identity.fingerprint
    });
    runtimeB.trustPeer({
      peerId: "peer-a",
      displayName: "Mikey",
      fingerprint: sessionA.identity.fingerprint
    });

    await Promise.all([sessionA.connect(), sessionB.connect()]);

    await sessionA.sendChat({
      roomName: "#general",
      displayName: "Mikey",
      text: "hello from node A"
    });

    await received;

    const remoteMessage = runtimeB.state.messages.find(
      (message) => message.content === "hello from node A"
    );

    expect(remoteMessage).toBeDefined();
    expect(remoteMessage?.actorId).toBe("peer_peer-a");
    expect(
      runtimeB.state.ledger.some(
        (entry) => entry.action === "peer.message.accept"
      )
    ).toBe(true);

    await Promise.all([sessionA.disconnect(), sessionB.disconnect()]);
  });

  it("surfaces an untrusted identity instead of delivering chat", async () => {
    const [transportA, transportB] = createMemoryTransportPair();

    let request:
      | { peerId: string; displayName: string; fingerprint: string }
      | undefined;

    const sessionA = await PeerSession.create({
      peerId: "peer-a",
      transport: transportA,
      trusts: () => []
    });

    const sessionB = await PeerSession.create({
      peerId: "peer-b",
      transport: transportB,
      trusts: () => [],
      handlers: {
        onUntrustedPeer(value) {
          request = value;
        }
      }
    });

    await Promise.all([sessionA.connect(), sessionB.connect()]);
    await sessionA.sendChat({
      roomName: "#general",
      displayName: "Mikey",
      text: "trust me?"
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request?.peerId).toBe("peer-a");
    expect(request?.fingerprint).toBe(sessionA.identity.fingerprint);

    await Promise.all([sessionA.disconnect(), sessionB.disconnect()]);
  });
});
