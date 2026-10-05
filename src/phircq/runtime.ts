import { createAttachmentMeta, type BlobStore } from "./attachments";
import { AgentRegistry, discoverOllama, type OllamaModel } from "./agents";
import { ActionBus, Authority } from "./bus";
import { parseInput } from "./commands";
import { CURRENT_SCHEMA_VERSION, migrateSnapshot } from "./migrations";
import type {
  Action,
  Actor,
  AgentDefinition,
  AttachmentMeta,
  LedgerEntry,
  Message,
  Room,
  RuntimeSnapshot
} from "./types";
import type { SnapshotStore } from "./store";

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function defaultSnapshot(): RuntimeSnapshot {
  const self: Actor = {
    id: "actor_operator",
    displayName: "Operator",
    type: "HUMAN",
    presence: "ONLINE",
    capabilities: ["SEND_MESSAGE", "ROOM_WRITE", "SEND_FILE", "INVOKE_AGENT", "MANAGE_AGENT"]
  };

  const phiBot: Actor = {
    id: "actor_phibot",
    displayName: "PhiBot",
    type: "AGENT",
    presence: "OFFLINE",
    capabilities: ["SEND_MESSAGE"]
  };

  const general: Room = {
    id: "room_general",
    name: "#general",
    topic: "Local PHircQ",
    memberIds: [self.id],
    archived: false
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    selfId: self.id,
    currentRoomId: general.id,
    actors: [self, phiBot],
    rooms: [general],
    messages: [
      {
        id: "msg_welcome",
        roomId: general.id,
        actorId: "system",
        timestamp: new Date().toISOString(),
        content: "PHircQ local runtime ready. Try /help.",
        format: "system",
        attachmentIds: []
      }
    ],
    ledger: [],
    attachments: [],
    agents: []
  };
}

export class ClientRuntime {
  private snapshot: RuntimeSnapshot;
  private readonly bus: ActionBus;
  private readonly blobStore?: BlobStore;
  private readonly agentRegistry: AgentRegistry;

  constructor(
    private readonly store: SnapshotStore,
    options: {
      blobStore?: BlobStore;
      agentRegistry?: AgentRegistry;
    } = {}
  ) {
    this.snapshot = migrateSnapshot(store.load()) ?? defaultSnapshot();
    this.blobStore = options.blobStore;
    this.agentRegistry = options.agentRegistry ?? new AgentRegistry();

    const self = this.snapshot.actors.find((actor) => actor.id === this.snapshot.selfId);
    if (self) {
      for (const capability of ["INVOKE_AGENT", "MANAGE_AGENT"]) {
        if (!self.capabilities.includes(capability)) self.capabilities.push(capability);
      }
    }

    this.bus = new ActionBus(
      () => this.snapshot.actors,
      new Authority(),
      (action) => this.handle(action),
      (action) => this.ledger(action, "DENY", "authority rejected action")
    );

    this.persist();
  }

  get state(): RuntimeSnapshot {
    return structuredClone(this.snapshot);
  }

  submit(raw: string): void {
    const parsed = parseInput(raw);
    const selfId = this.snapshot.selfId;

    switch (parsed.kind) {
      case "message":
        if (parsed.text.trim()) {
          this.bus.dispatch({
            actorId: selfId,
            type: "message.send",
            target: this.snapshot.currentRoomId,
            payload: {
              text: parsed.text,
              format: "text",
              attachmentIds: []
            }
          });
        }
        break;

      case "me":
        if (parsed.text) {
          this.bus.dispatch({
            actorId: selfId,
            type: "message.send",
            target: this.snapshot.currentRoomId,
            payload: {
              text: parsed.text,
              format: "action",
              attachmentIds: []
            }
          });
        }
        break;

      case "join":
        if (parsed.room) {
          this.bus.dispatch({
            actorId: selfId,
            type: "room.join",
            payload: { name: parsed.room }
          });
        }
        break;

      case "nick":
        if (parsed.name) {
          this.bus.dispatch({
            actorId: selfId,
            type: "identity.rename",
            payload: { name: parsed.name }
          });
        }
        break;

      case "topic":
        this.bus.dispatch({
          actorId: selfId,
          type: "room.topic",
          target: this.snapshot.currentRoomId,
          payload: { text: parsed.text }
        });
        break;

      case "who":
        this.systemMessage(
          this.snapshot.actors
            .filter((actor) => actor.presence !== "OFFLINE")
            .map((actor) => actor.displayName)
            .join(", ") || "Nobody online."
        );
        break;

      case "help":
        this.systemMessage(
          "/join #room  /me action  /nick name  /who  /topic text  /help"
        );
        break;

      case "unknown":
        this.systemMessage(`Unknown command: /${parsed.command}`);
        break;
    }

    this.persist();
  }

  async attachFile(file: File): Promise<AttachmentMeta> {
    if (!this.blobStore) {
      throw new Error("Blob storage is unavailable.");
    }

    const meta = await createAttachmentMeta(file, this.snapshot.selfId);
    await this.blobStore.put(meta.id, file);

    const accepted = this.bus.dispatch({
      actorId: this.snapshot.selfId,
      type: "file.attach",
      target: this.snapshot.currentRoomId,
      payload: { meta }
    });

    if (!accepted) {
      await this.blobStore.delete(meta.id);
      throw new Error("Attachment was denied by authority.");
    }

    this.persist();
    return meta;
  }

  async getAttachmentBlob(id: string): Promise<Blob | null> {
    return this.blobStore?.get(id) ?? null;
  }

  async discoverOllamaModels(endpoint: string): Promise<OllamaModel[]> {
    return discoverOllama(endpoint);
  }

  createOllamaAgent(input: {
    name: string;
    model: string;
    endpoint: string;
    capabilities?: string[];
  }): AgentDefinition {
    const name = input.name.trim();
    const model = input.model.trim();
    const endpoint = input.endpoint.trim();

    if (!name) throw new Error("Agent name is required.");
    if (!model) throw new Error("Ollama model is required.");
    if (!endpoint) throw new Error("Ollama endpoint is required.");

    const actorId = uid("actor_agent");
    const definition: AgentDefinition = {
      id: uid("agent"),
      actorId,
      name,
      provider: "ollama",
      model,
      endpoint,
      capabilities: input.capabilities ?? ["SEND_MESSAGE"],
      enabled: true
    };

    const accepted = this.bus.dispatch({
      actorId: this.snapshot.selfId,
      type: "agent.create",
      target: definition.id,
      payload: { definition }
    });

    if (!accepted) throw new Error("Agent creation denied by authority.");

    this.persist();
    return structuredClone(definition);
  }

  setAgentEnabled(agentId: string, enabled: boolean): void {
    const definition = this.snapshot.agents.find((agent) => agent.id === agentId);
    if (!definition) throw new Error("Agent not found.");

    const accepted = this.bus.dispatch({
      actorId: this.snapshot.selfId,
      type: "agent.configure",
      target: agentId,
      payload: { enabled }
    });

    if (!accepted) throw new Error("Agent configuration denied by authority.");
    this.persist();
  }

  async invokeAgent(agentId: string, prompt: string): Promise<string> {
    const definition = this.snapshot.agents.find((agent) => agent.id === agentId);
    if (!definition) throw new Error("Agent not found.");
    if (!definition.enabled) throw new Error("Agent is disabled.");
    if (!prompt.trim()) throw new Error("Prompt is required.");

    const allowed = this.bus.dispatch({
      actorId: this.snapshot.selfId,
      type: "agent.invoke",
      target: agentId,
      payload: { prompt }
    });

    if (!allowed) throw new Error("Agent invocation denied by authority.");

    const actor = this.snapshot.actors.find((item) => item.id === definition.actorId);
    if (!actor) throw new Error("Agent actor is missing.");

    actor.presence = "AGENT_WORKING";
    this.persist();

    const room = this.snapshot.rooms.find((item) => item.id === this.snapshot.currentRoomId);
    const recentMessages = this.snapshot.messages
      .filter((message) => message.roomId === this.snapshot.currentRoomId)
      .slice(-12);

    try {
      const adapter = this.agentRegistry.adapterFor(definition);
      const response = await adapter.generate(definition, {
        prompt,
        roomName: room?.name ?? "#unknown",
        recentMessages
      });

      const sent = this.bus.dispatch({
        actorId: definition.actorId,
        type: "message.send",
        target: this.snapshot.currentRoomId,
        payload: {
          text: response,
          format: "text",
          attachmentIds: []
        }
      });

      if (!sent) throw new Error("Agent response denied by authority.");

      actor.presence = "AGENT_IDLE";
      this.ledger(
        {
          actorId: this.snapshot.selfId,
          type: "agent.complete",
          target: agentId
        },
        "ALLOW",
        definition.model
      );
      this.persist();
      return response;
    } catch (error) {
      actor.presence = "AGENT_IDLE";
      this.ledger(
        {
          actorId: this.snapshot.selfId,
          type: "agent.fail",
          target: agentId
        },
        "DENY",
        error instanceof Error ? error.message : "agent invocation failed"
      );
      this.persist();
      throw error;
    }
  }

  selectRoom(roomId: string): void {
    if (
      this.snapshot.rooms.some(
        (room) => room.id === roomId && !room.archived
      )
    ) {
      this.snapshot.currentRoomId = roomId;
      this.persist();
    }
  }

  createRoom(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;

    const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

    this.bus.dispatch({
      actorId: this.snapshot.selfId,
      type: "room.join",
      payload: { name: normalized }
    });

    this.persist();
  }

  private handle(action: Action): void {
    if (action.type === "message.send") {
      const payload = action.payload as {
        text: string;
        format: "text" | "action";
        attachmentIds?: string[];
      };

      this.snapshot.messages.push({
        id: uid("msg"),
        roomId: action.target!,
        actorId: action.actorId,
        timestamp: new Date().toISOString(),
        content: payload.text,
        format: payload.format,
        attachmentIds: payload.attachmentIds ?? []
      });

      this.ledger(action, "ALLOW");
      return;
    }

    if (action.type === "file.attach") {
      const { meta } = action.payload as { meta: AttachmentMeta };

      if (!this.snapshot.attachments.some((item) => item.id === meta.id)) {
        this.snapshot.attachments.push(meta);
      }

      this.snapshot.messages.push({
        id: uid("msg"),
        roomId: action.target!,
        actorId: action.actorId,
        timestamp: new Date().toISOString(),
        content: `shared ${meta.name}`,
        format: "text",
        attachmentIds: [meta.id]
      });

      this.ledger(
        action,
        "ALLOW",
        `${meta.name} ${meta.size} bytes sha256:${meta.sha256}`
      );
      return;
    }

    if (action.type === "agent.create") {
      const { definition } = action.payload as { definition: AgentDefinition };

      if (!this.snapshot.agents.some((agent) => agent.id === definition.id)) {
        this.snapshot.agents.push(definition);
        this.snapshot.actors.push({
          id: definition.actorId,
          displayName: definition.name,
          type: "AGENT",
          presence: "AGENT_IDLE",
          capabilities: [...definition.capabilities]
        });

        const room = this.snapshot.rooms.find(
          (item) => item.id === this.snapshot.currentRoomId
        );
        if (room && !room.memberIds.includes(definition.actorId)) {
          room.memberIds.push(definition.actorId);
        }
      }

      this.ledger(
        action,
        "ALLOW",
        `${definition.name} / ${definition.model} / ${definition.provider}`
      );
      return;
    }

    if (action.type === "agent.configure") {
      const definition = this.snapshot.agents.find(
        (agent) => agent.id === action.target
      );
      if (definition) {
        const { enabled } = action.payload as { enabled: boolean };
        definition.enabled = enabled;
        const actor = this.snapshot.actors.find(
          (item) => item.id === definition.actorId
        );
        if (actor) actor.presence = enabled ? "AGENT_IDLE" : "OFFLINE";
      }

      this.ledger(
        action,
        "ALLOW",
        (action.payload as { enabled: boolean }).enabled ? "enabled" : "disabled"
      );
      return;
    }

    if (action.type === "agent.invoke") {
      this.ledger(action, "ALLOW");
      return;
    }

    if (action.type === "room.join") {
      const { name } = action.payload as { name: string };
      let room = this.snapshot.rooms.find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
      );

      if (!room) {
        room = {
          id: uid("room"),
          name,
          topic: "",
          memberIds: [action.actorId],
          archived: false
        };
        this.snapshot.rooms.push(room);
      } else if (!room.memberIds.includes(action.actorId)) {
        room.memberIds.push(action.actorId);
      }

      this.snapshot.currentRoomId = room.id;
      this.ledger(action, "ALLOW", name);
      return;
    }

    if (action.type === "room.topic") {
      const room = this.snapshot.rooms.find(
        (candidate) => candidate.id === action.target
      );

      if (room) {
        room.topic = (action.payload as { text: string }).text;
      }

      this.ledger(action, "ALLOW");
      return;
    }

    if (action.type === "identity.rename") {
      const actor = this.snapshot.actors.find(
        (candidate) => candidate.id === action.actorId
      );

      if (actor) {
        actor.displayName = (action.payload as { name: string }).name;
      }

      this.ledger(action, "ALLOW");
    }
  }

  private ledger(
    action: Action,
    result: "ALLOW" | "DENY",
    detail?: string
  ): void {
    const entry: LedgerEntry = {
      id: uid("ledger"),
      timestamp: new Date().toISOString(),
      actorId: action.actorId,
      action: action.type,
      target: action.target,
      result,
      detail
    };

    this.snapshot.ledger.push(entry);
  }

  private systemMessage(content: string): void {
    const message: Message = {
      id: uid("msg"),
      roomId: this.snapshot.currentRoomId,
      actorId: "system",
      timestamp: new Date().toISOString(),
      content,
      format: "system",
      attachmentIds: []
    };

    this.snapshot.messages.push(message);
  }

  private persist(): void {
    this.store.save(this.snapshot);
  }
}
