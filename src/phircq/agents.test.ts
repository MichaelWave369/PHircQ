import { describe, expect, it, vi } from "vitest";
import { AgentRegistry, discoverOllama, type AgentAdapter } from "./agents";
import type { AgentDefinition } from "./types";

describe("agents", () => {
  it("discovers local Ollama models without provider-specific UI parsing", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "qwen:test", size: 123, modified_at: "2026-10-04T00:00:00Z" }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const models = await discoverOllama("http://localhost:11434/", fakeFetch as typeof fetch);

    expect(fakeFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      { method: "GET" }
    );
    expect(models[0]?.name).toBe("qwen:test");
  });

  it("routes a definition to its registered adapter", async () => {
    const adapter: AgentAdapter = {
      provider: "ollama",
      async generate() {
        return "ok";
      }
    };
    const registry = new AgentRegistry([adapter]);
    const definition: AgentDefinition = {
      id: "agent_1",
      actorId: "actor_1",
      name: "Test",
      provider: "ollama",
      model: "model",
      endpoint: "http://localhost:11434",
      capabilities: ["SEND_MESSAGE"],
      enabled: true
    };

    await expect(
      registry.adapterFor(definition).generate(definition, {
        prompt: "hi",
        roomName: "#general",
        recentMessages: []
      })
    ).resolves.toBe("ok");
  });
});
