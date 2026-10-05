import type { AgentDefinition, Message } from "./types";

export interface AgentGenerateInput {
  prompt: string;
  roomName: string;
  recentMessages: Array<Pick<Message, "actorId" | "content" | "format">>;
}

export interface AgentAdapter {
  readonly provider: AgentDefinition["provider"];
  generate(definition: AgentDefinition, input: AgentGenerateInput): Promise<string>;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modifiedAt?: string;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export async function discoverOllama(
  endpoint = "http://localhost:11434",
  fetchImpl: typeof fetch = fetch
): Promise<OllamaModel[]> {
  const response = await fetchImpl(`${normalizeEndpoint(endpoint)}/api/tags`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Ollama discovery failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{
      name?: string;
      size?: number;
      modified_at?: string;
    }>;
  };

  return (payload.models ?? [])
    .filter((model): model is { name: string; size?: number; modified_at?: string } =>
      typeof model.name === "string" && model.name.length > 0
    )
    .map((model) => ({
      name: model.name,
      size: model.size,
      modifiedAt: model.modified_at
    }));
}

export class OllamaAgentAdapter implements AgentAdapter {
  readonly provider = "ollama" as const;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async generate(
    definition: AgentDefinition,
    input: AgentGenerateInput
  ): Promise<string> {
    const response = await this.fetchImpl(
      `${normalizeEndpoint(definition.endpoint)}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: definition.model,
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "You are an agent participating in a PHircQ room. Respond concisely and do not claim capabilities you do not have."
            },
            ...input.recentMessages.slice(-12).map((message) => ({
              role: "user",
              content: `[${message.actorId}] ${message.content}`
            })),
            {
              role: "user",
              content: input.prompt
            }
          ]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama generation failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };

    const text = payload.message?.content?.trim();
    if (!text) throw new Error("Ollama returned an empty response.");
    return text;
  }
}

export class AgentRegistry {
  private readonly adapters = new Map<AgentDefinition["provider"], AgentAdapter>();

  constructor(adapters: AgentAdapter[] = [new OllamaAgentAdapter()]) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  adapterFor(definition: AgentDefinition): AgentAdapter {
    const adapter = this.adapters.get(definition.provider);
    if (!adapter) throw new Error(`No adapter registered for ${definition.provider}.`);
    return adapter;
  }
}
