import type { Action, Actor } from "./types";

export type ActionHandler = (action: Action) => void;

export class Authority {
  can(actor: Actor | undefined, action: Action): boolean {
    if (!actor) return false;
    if (actor.type === "SYSTEM") return true;

    if (action.type.startsWith("message.")) {
      return actor.capabilities.includes("SEND_MESSAGE");
    }

    if (action.type.startsWith("room.")) {
      return actor.capabilities.includes("ROOM_WRITE");
    }

    if (action.type.startsWith("file.")) {
      return actor.capabilities.includes("SEND_FILE");
    }

    if (action.type === "agent.invoke") {
      return actor.capabilities.includes("INVOKE_AGENT");
    }

    if (action.type.startsWith("agent.")) {
      return actor.capabilities.includes("MANAGE_AGENT");
    }

    if (action.type.startsWith("identity.")) {
      return action.actorId === actor.id;
    }

    return false;
  }
}

export class ActionBus {
  constructor(
    private readonly actors: () => Actor[],
    private readonly authority: Authority,
    private readonly handler: ActionHandler,
    private readonly denied: ActionHandler
  ) {}

  dispatch(action: Action): boolean {
    const actor = this.actors().find((candidate) => candidate.id === action.actorId);

    if (!this.authority.can(actor, action)) {
      this.denied(action);
      return false;
    }

    this.handler(action);
    return true;
  }
}
