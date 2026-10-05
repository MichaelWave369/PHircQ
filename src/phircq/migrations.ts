import type { RuntimeSnapshot } from "./types";

export const CURRENT_SCHEMA_VERSION = 2;

type LegacySnapshot = Partial<RuntimeSnapshot> & {
  schemaVersion?: number;
};

export function migrateSnapshot(input: LegacySnapshot | null | undefined): RuntimeSnapshot | null {
  if (!input || !input.selfId || !input.currentRoomId) return null;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    selfId: input.selfId,
    currentRoomId: input.currentRoomId,
    actors: Array.isArray(input.actors)
      ? input.actors.map((actor) => ({
          ...actor,
          capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : []
        }))
      : [],
    rooms: Array.isArray(input.rooms)
      ? input.rooms.map((room) => ({
          ...room,
          memberIds: Array.isArray(room.memberIds) ? room.memberIds : []
        }))
      : [],
    messages: Array.isArray(input.messages)
      ? input.messages.map((message) => ({
          ...message,
          attachmentIds: Array.isArray(message.attachmentIds) ? message.attachmentIds : []
        }))
      : [],
    ledger: Array.isArray(input.ledger) ? input.ledger : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    agents: Array.isArray(input.agents)
      ? input.agents.map((agent) => ({
          ...agent,
          capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
          enabled: agent.enabled !== false
        }))
      : []
  };
}
