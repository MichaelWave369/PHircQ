import { ActionBus, Authority } from "./bus";
import { parseInput } from "./commands";
import type { Action, Actor, LedgerEntry, Message, Room, RuntimeSnapshot } from "./types";
import type { SnapshotStore } from "./store";

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function defaultSnapshot(): RuntimeSnapshot {
  const self: Actor = {
    id: "actor_operator",
    displayName: "Operator",
    type: "HUMAN",
    presence: "ONLINE",
    capabilities: ["SEND_MESSAGE", "ROOM_WRITE"]
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
    selfId: self.id,
    currentRoomId: general.id,
    actors: [self, phiBot],
    rooms: [general],
    messages: [{
      id: "msg_welcome",
      roomId: general.id,
      actorId: "system",
      timestamp: new Date().toISOString(),
      content: "PHircQ local runtime ready. Try /help.",
      format: "system"
    }],
    ledger: []
  };
}

export class ClientRuntime {
  private snapshot: RuntimeSnapshot;
  private readonly bus: ActionBus;

  constructor(private readonly store: SnapshotStore) {
    this.snapshot = store.load() ?? defaultSnapshot();
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
            payload: { text: parsed.text, format: "text" }
          });
        }
        break;
      case "me":
        if (parsed.text) {
          this.bus.dispatch({
            actorId: selfId,
            type: "message.send",
            target: this.snapshot.currentRoomId,
            payload: { text: parsed.text, format: "action" }
          });
        }
        break;
      case "join":
        if (parsed.room) {
          this.bus.dispatch({ actorId: selfId, type: "room.join", payload: { name: parsed.room } });
        }
        break;
      case "nick":
        if (parsed.name) {
          this.bus.dispatch({ actorId: selfId, type: "identity.rename", payload: { name: parsed.name } });
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
        this.systemMessage("/join #room  /me action  /nick name  /who  /topic text  /help");
        break;
      case "unknown":
        this.systemMessage(`Unknown command: /${parsed.command}`);
        break;
    }

    this.persist();
  }

  selectRoom(roomId: string): void {
    if (this.snapshot.rooms.some((room) => room.id === roomId && !room.archived)) {
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
      const payload = action.payload as { text: string; format: "text" | "action" };
      this.snapshot.messages.push({
        id: uid("msg"),
        roomId: action.target!,
        actorId: action.actorId,
        timestamp: new Date().toISOString(),
        content: payload.text,
        format: payload.format
      });
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
      const room = this.snapshot.rooms.find((candidate) => candidate.id === action.target);
      if (room) room.topic = (action.payload as { text: string }).text;
      this.ledger(action, "ALLOW");
      return;
    }

    if (action.type === "identity.rename") {
      const actor = this.snapshot.actors.find((candidate) => candidate.id === action.actorId);
      if (actor) actor.displayName = (action.payload as { name: string }).name;
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
      format: "system"
    };
    this.snapshot.messages.push(message);
  }

  private persist(): void {
    this.store.save(this.snapshot);
  }
}
