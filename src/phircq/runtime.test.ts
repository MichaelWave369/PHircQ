import { describe, expect, it } from "vitest";
import { AgentRegistry, type AgentAdapter } from "./agents";
import { MemoryBlobStore } from "./attachments";
import { ClientRuntime } from "./runtime";
import { MemoryStore } from "./store";

describe("ClientRuntime", () => {
  it("creates a room through the action boundary", () => {
    const runtime = new ClientRuntime(new MemoryStore());
    runtime.submit("/join #music");

    expect(
      runtime.state.rooms.some((room) => room.name === "#music")
    ).toBe(true);
    expect(runtime.state.ledger.at(-1)?.action).toBe("room.join");
  });

  it("persists messages across runtime restart", () => {
    const store = new MemoryStore();
    const first = new ClientRuntime(store);
    first.submit("hello PHircQ");

    const second = new ClientRuntime(store);
    expect(
      second.state.messages.some(
        (message) => message.content === "hello PHircQ"
      )
    ).toBe(true);
  });

  it("renames the local actor", () => {
    const runtime = new ClientRuntime(new MemoryStore());
    runtime.submit("/nick Mikey");

    const self = runtime.state.actors.find(
      (actor) => actor.id === runtime.state.selfId
    );

    expect(self?.displayName).toBe("Mikey");
  });

  it("attaches governed local files with metadata and a ledger receipt", async () => {
    const runtime = new ClientRuntime(new MemoryStore(), {
      blobStore: new MemoryBlobStore()
    });

    const file = new Blob(["hello from PHircQ"], {
      type: "text/plain"
    }) as File;

    Object.defineProperty(file, "name", {
      value: "hello.txt"
    });

    const meta = await runtime.attachFile(file);

    expect(meta.name).toBe("hello.txt");
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.state.attachments).toHaveLength(1);
    expect(runtime.state.messages.at(-1)?.attachmentIds).toEqual([meta.id]);
    expect(runtime.state.ledger.at(-1)?.action).toBe("file.attach");

    const restored = await runtime.getAttachmentBlob(meta.id);
    expect(await restored?.text()).toBe("hello from PHircQ");
  });

  it("runs an agent through authority and the shared room message path", async () => {
    const adapter: AgentAdapter = {
      provider: "ollama",
      async generate() {
        return "agent says hello";
      }
    };

    const runtime = new ClientRuntime(new MemoryStore(), {
      agentRegistry: new AgentRegistry([adapter])
    });

    const agent = runtime.createOllamaAgent({
      name: "LocalCoder",
      model: "test-model",
      endpoint: "http://localhost:11434"
    });

    await runtime.invokeAgent(agent.id, "say hello");

    const actor = runtime.state.actors.find(
      (item) => item.id === agent.actorId
    );

    expect(actor?.presence).toBe("AGENT_IDLE");
    expect(runtime.state.messages.at(-1)?.actorId).toBe(agent.actorId);
    expect(runtime.state.messages.at(-1)?.content).toBe("agent says hello");
    expect(
      runtime.state.ledger.some((entry) => entry.action === "agent.invoke")
    ).toBe(true);
    expect(
      runtime.state.ledger.some((entry) => entry.action === "agent.complete")
    ).toBe(true);
  });

  it("persists and removes explicit peer trust through governance", () => {
    const store = new MemoryStore();
    const first = new ClientRuntime(store);

    first.trustPeer({
      peerId: "peer-a",
      displayName: "TestPeer",
      fingerprint: "a".repeat(64)
    });

    const second = new ClientRuntime(store);
    expect(second.state.peers).toHaveLength(1);
    expect(second.state.peers[0]?.peerId).toBe("peer-a");

    second.removePeer("peer-a");
    expect(second.state.peers).toHaveLength(0);
    expect(
      second.state.ledger.some((entry) => entry.action === "peer.remove")
    ).toBe(true);
  });

  it("rejects remote chat addressed to an unknown room", () => {
    const runtime = new ClientRuntime(new MemoryStore());

    runtime.trustPeer({
      peerId: "peer-a",
      displayName: "TestPeer",
      fingerprint: "b".repeat(64)
    });

    expect(
      runtime.receivePeerChat({
        peerId: "peer-a",
        displayName: "TestPeer",
        roomName: "#does-not-exist",
        text: "nope",
        frameId: "frame-1"
      })
    ).toBe(false);

    expect(
      runtime.state.messages.some((message) => message.content === "nope")
    ).toBe(false);
  });
  it("stores a verified trusted peer file through governed attachment admission", async () => {
    const store = new MemoryStore();
    const blobs = new MemoryBlobStore();
    const runtime = new ClientRuntime(store, { blobStore: blobs });

    runtime.trustPeer({
      peerId: "peer-a",
      displayName: "TestPeer",
      fingerprint: "c".repeat(64)
    });

    const blob = new Blob(["remote bytes"], { type: "text/plain" });
    const meta = await runtime.receivePeerFile({
      peerId: "peer-a",
      displayName: "TestPeer",
      roomName: "#general",
      name: "remote.txt",
      mimeType: "text/plain",
      size: blob.size,
      sha256: "d".repeat(64),
      transferId: "transfer-1",
      blob
    });

    expect(runtime.state.attachments.some((item) => item.id === meta.id)).toBe(true);
    expect(runtime.state.messages.at(-1)?.attachmentIds).toEqual([meta.id]);
    expect(await (await runtime.getAttachmentBlob(meta.id))?.text()).toBe("remote bytes");
    expect(
      runtime.state.ledger.some((entry) => entry.action === "peer.file.accept")
    ).toBe(true);
  });

});
