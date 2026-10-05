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

    let resolveRequest!: (value: {
      peerId: string;
      displayName: string;
      fingerprint: string;
    }) => void;

    const requestPromise = new Promise<{
      peerId: string;
      displayName: string;
      fingerprint: string;
    }>((resolve) => {
      resolveRequest = resolve;
    });

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
          resolveRequest(value);
        }
      }
    });

    await Promise.all([sessionA.connect(), sessionB.connect()]);
    await sessionA.sendChat({
      roomName: "#general",
      displayName: "Mikey",
      text: "trust me?"
    });

    const request = await Promise.race([
      requestPromise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Timed out waiting for untrusted peer callback.")),
          1000
        );
      })
    ]);

    expect(request.peerId).toBe("peer-a");
    expect(request.fingerprint).toBe(sessionA.identity.fingerprint);

    await Promise.all([sessionA.disconnect(), sessionB.disconnect()]);
  });

  it("requires explicit acceptance before moving chunked peer file bytes", async () => {
    const runtimeA = new ClientRuntime(new MemoryStore());
    const runtimeB = new ClientRuntime(new MemoryStore());
    const [transportA, transportB] = createMemoryTransportPair();

    let sessionB!: PeerSession;
    let resolveReceived!: (value: { blob: Blob; sha256: string; name: string }) => void;
    const received = new Promise<{ blob: Blob; sha256: string; name: string }>((resolve) => {
      resolveReceived = resolve;
    });

    let resolveSent!: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });

    const sessionA = await PeerSession.create({
      peerId: "peer-a",
      transport: transportA,
      trusts: () => runtimeA.state.peers,
      handlers: {
        onFileStatus(status) {
          if (status.status === "sent") resolveSent();
        }
      }
    });

    sessionB = await PeerSession.create({
      peerId: "peer-b",
      transport: transportB,
      trusts: () => runtimeB.state.peers,
      handlers: {
        onFileOffer(offer) {
          void sessionB.acceptFile(offer.offer.transferId);
        },
        onFileReceived(file) {
          resolveReceived({
            blob: file.blob,
            sha256: file.sha256,
            name: file.name
          });
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

    const source = new Blob(
      ["PHircQ direct peer file transfer ".repeat(900)],
      { type: "text/plain" }
    );

    const offer = await sessionA.offerFile({
      file: source,
      name: "peer-note.txt",
      roomName: "#general",
      displayName: "Mikey"
    });

    expect(offer.totalChunks).toBeGreaterThan(1);

    const result = await Promise.race([
      received,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Timed out waiting for peer file transfer.")),
          2000
        );
      })
    ]);

    await Promise.race([
      sent,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Timed out waiting for file receipt.")),
          2000
        );
      })
    ]);

    expect(result.name).toBe("peer-note.txt");
    expect(result.sha256).toBe(offer.sha256);
    expect(result.blob.size).toBe(source.size);
    expect(await result.blob.text()).toBe(await source.text());

    await Promise.all([sessionA.disconnect(), sessionB.disconnect()]);
  });
});
