import { describe, expect, it } from "vitest";
import { ClientRuntime } from "./runtime";
import { MemoryStore } from "./store";

describe("ClientRuntime", () => {
  it("creates a room through the action boundary", () => {
    const runtime = new ClientRuntime(new MemoryStore());
    runtime.submit("/join #music");
    expect(runtime.state.rooms.some((room) => room.name === "#music")).toBe(true);
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
});
