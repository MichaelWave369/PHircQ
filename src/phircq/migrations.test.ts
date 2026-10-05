import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateSnapshot } from "./migrations";

describe("migrateSnapshot", () => {
  it("upgrades the v0.1 shape without losing messages", () => {
    const migrated = migrateSnapshot({
      selfId: "actor_operator",
      currentRoomId: "room_general",
      actors: [
        {
          id: "actor_operator",
          displayName: "Operator",
          type: "HUMAN",
          presence: "ONLINE",
          capabilities: ["SEND_MESSAGE"]
        }
      ],
      rooms: [
        {
          id: "room_general",
          name: "#general",
          topic: "",
          memberIds: ["actor_operator"],
          archived: false
        }
      ],
      messages: [
        {
          id: "msg_1",
          roomId: "room_general",
          actorId: "actor_operator",
          timestamp: "2026-10-04T00:00:00.000Z",
          content: "hello",
          format: "text"
        } as never
      ],
      ledger: []
    });

    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated?.messages[0].attachmentIds).toEqual([]);
    expect(migrated?.attachments).toEqual([]);
  });

  it("rejects incomplete state", () => {
    expect(migrateSnapshot({ selfId: "actor_operator" })).toBeNull();
  });
});
