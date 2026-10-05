import { describe, expect, it } from "vitest";
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
});
