import { describe, expect, it, vi } from "vitest";
import { ActionBus, Authority } from "./bus";
import type { Actor } from "./types";

describe("ActionBus", () => {
  const actor: Actor = {
    id: "a",
    displayName: "A",
    type: "HUMAN",
    presence: "ONLINE",
    capabilities: ["SEND_MESSAGE"]
  };

  it("allows a granted capability", () => {
    const handler = vi.fn();
    const denied = vi.fn();
    const bus = new ActionBus(() => [actor], new Authority(), handler, denied);

    expect(bus.dispatch({ actorId: "a", type: "message.send" })).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(denied).not.toHaveBeenCalled();
  });

  it("denies a missing capability", () => {
    const handler = vi.fn();
    const denied = vi.fn();
    const bus = new ActionBus(() => [actor], new Authority(), handler, denied);

    expect(bus.dispatch({ actorId: "a", type: "room.join" })).toBe(false);
    expect(denied).toHaveBeenCalledOnce();
  });
});
