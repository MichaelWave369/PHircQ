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

  it("allows invoke without granting agent management", () => {
    const handler = vi.fn();
    const denied = vi.fn();
    const invoker: Actor = {
      ...actor,
      capabilities: ["INVOKE_AGENT"]
    };
    const bus = new ActionBus(() => [invoker], new Authority(), handler, denied);

    expect(bus.dispatch({ actorId: "a", type: "agent.invoke" })).toBe(true);
    expect(bus.dispatch({ actorId: "a", type: "agent.create" })).toBe(false);
    expect(denied).toHaveBeenCalledOnce();
  });

  it("requires MANAGE_PEER for trust changes", () => {
    const handler = vi.fn();
    const denied = vi.fn();
    const manager: Actor = {
      ...actor,
      capabilities: ["MANAGE_PEER"]
    };
    const bus = new ActionBus(() => [manager], new Authority(), handler, denied);

    expect(bus.dispatch({ actorId: "a", type: "peer.trust" })).toBe(true);
    expect(bus.dispatch({ actorId: "a", type: "peer.remove" })).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("denies a missing capability", () => {
    const handler = vi.fn();
    const denied = vi.fn();
    const bus = new ActionBus(() => [actor], new Authority(), handler, denied);

    expect(bus.dispatch({ actorId: "a", type: "room.join" })).toBe(false);
    expect(denied).toHaveBeenCalledOnce();
  });
});
