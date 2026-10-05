import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { migrateSnapshot } from "./migrations";
import type {
  Actor,
  AttachmentMeta,
  LedgerEntry,
  Message,
  Room,
  RuntimeSnapshot
} from "./types";
import type { SnapshotStore } from "./store";

const DEFAULT_KEY = "phircq:sqlite:v1";
const LEGACY_KEY = "phircq:v0.1";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function rows<T>(db: Database, sql: string): T[] {
  const statement = db.prepare(sql);
  const output: T[] = [];
  try {
    while (statement.step()) output.push(statement.getAsObject() as T);
  } finally {
    statement.free();
  }
  return output;
}

export class SqliteSnapshotStore implements SnapshotStore {
  private constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly storageKey: string
  ) {}

  static async create(options?: {
    storage?: Storage;
    storageKey?: string;
    legacyKey?: string;
    SQL?: SqlJsStatic;
  }): Promise<SqliteSnapshotStore> {
    const storage = options?.storage ?? window.localStorage;
    const storageKey = options?.storageKey ?? DEFAULT_KEY;
    const legacyKey = options?.legacyKey ?? LEGACY_KEY;
    const SQL =
      options?.SQL ??
      (await initSqlJs({
        locateFile: () => sqlWasmUrl
      }));

    const saved = storage.getItem(storageKey);
    const db = saved
      ? new SQL.Database(base64ToBytes(saved))
      : new SQL.Database();

    const store = new SqliteSnapshotStore(db, storage, storageKey);
    store.ensureSchema();

    if (!store.load()) {
      const legacyRaw = storage.getItem(legacyKey);
      if (legacyRaw) {
        try {
          const migrated = migrateSnapshot(
            JSON.parse(legacyRaw) as Partial<RuntimeSnapshot>
          );
          if (migrated) store.save(migrated);
        } catch {
          // Leave unreadable legacy state untouched rather than destroying it.
        }
      }
    }

    return store;
  }

  load(): RuntimeSnapshot | null {
    const settings = rows<{ key: string; value: string }>(
      this.db,
      "SELECT key, value FROM settings ORDER BY key"
    );

    if (settings.length === 0) return null;

    const settingMap = new Map(settings.map((row) => [row.key, row.value]));
    const selfId = settingMap.get("selfId");
    const currentRoomId = settingMap.get("currentRoomId");
    if (!selfId || !currentRoomId) return null;

    let agents: RuntimeSnapshot["agents"] = [];
    const agentsJson = settingMap.get("agentsJson");
    if (agentsJson) {
      try {
        agents = JSON.parse(agentsJson) as RuntimeSnapshot["agents"];
      } catch {
        agents = [];
      }
    }

    const actors = rows<{
      id: string;
      display_name: string;
      type: Actor["type"];
      presence: Actor["presence"];
      capabilities_json: string;
    }>(
      this.db,
      "SELECT id, display_name, type, presence, capabilities_json FROM actors ORDER BY rowid"
    ).map(
      (row): Actor => ({
        id: row.id,
        displayName: row.display_name,
        type: row.type,
        presence: row.presence,
        capabilities: JSON.parse(row.capabilities_json) as string[]
      })
    );

    const members = rows<{ room_id: string; actor_id: string }>(
      this.db,
      "SELECT room_id, actor_id FROM room_members ORDER BY room_id, ordinal"
    );

    const rooms = rows<{
      id: string;
      name: string;
      topic: string;
      archived: number;
    }>(
      this.db,
      "SELECT id, name, topic, archived FROM rooms ORDER BY rowid"
    ).map(
      (row): Room => ({
        id: row.id,
        name: row.name,
        topic: row.topic,
        archived: Boolean(row.archived),
        memberIds: members
          .filter((member) => member.room_id === row.id)
          .map((member) => member.actor_id)
      })
    );

    const messageAttachments = rows<{ message_id: string; attachment_id: string }>(
      this.db,
      "SELECT message_id, attachment_id FROM message_attachments ORDER BY message_id, ordinal"
    );

    const messages = rows<{
      id: string;
      room_id: string;
      actor_id: string;
      timestamp: string;
      content: string;
      format: Message["format"];
    }>(
      this.db,
      "SELECT id, room_id, actor_id, timestamp, content, format FROM messages ORDER BY ordinal"
    ).map(
      (row): Message => ({
        id: row.id,
        roomId: row.room_id,
        actorId: row.actor_id,
        timestamp: row.timestamp,
        content: row.content,
        format: row.format,
        attachmentIds: messageAttachments
          .filter((item) => item.message_id === row.id)
          .map((item) => item.attachment_id)
      })
    );

    const ledger = rows<{
      id: string;
      timestamp: string;
      actor_id: string;
      action: string;
      target: string | null;
      result: LedgerEntry["result"];
      detail: string | null;
    }>(
      this.db,
      "SELECT id, timestamp, actor_id, action, target, result, detail FROM ledger ORDER BY ordinal"
    ).map(
      (row): LedgerEntry => ({
        id: row.id,
        timestamp: row.timestamp,
        actorId: row.actor_id,
        action: row.action,
        target: row.target ?? undefined,
        result: row.result,
        detail: row.detail ?? undefined
      })
    );

    const attachments = rows<{
      id: string;
      actor_id: string;
      name: string;
      mime_type: string;
      size: number;
      sha256: string;
      created_at: string;
    }>(
      this.db,
      "SELECT id, actor_id, name, mime_type, size, sha256, created_at FROM attachments ORDER BY rowid"
    ).map(
      (row): AttachmentMeta => ({
        id: row.id,
        actorId: row.actor_id,
        name: row.name,
        mimeType: row.mime_type,
        size: row.size,
        sha256: row.sha256,
        createdAt: row.created_at
      })
    );

    return migrateSnapshot({
      schemaVersion: 1,
      selfId,
      currentRoomId,
      actors,
      rooms,
      messages,
      ledger,
      attachments,
      agents
    });
  }

  save(snapshot: RuntimeSnapshot): void {
    const normalized = migrateSnapshot(snapshot);
    if (!normalized) return;

    this.db.run("BEGIN");
    try {
      for (const table of [
        "settings",
        "actors",
        "rooms",
        "room_members",
        "messages",
        "ledger",
        "attachments",
        "message_attachments"
      ]) {
        this.db.run(`DELETE FROM ${table}`);
      }

      const setting = this.db.prepare("INSERT INTO settings(key, value) VALUES (?, ?)");
      setting.run(["selfId", normalized.selfId]);
      setting.run(["currentRoomId", normalized.currentRoomId]);
      setting.run(["schemaVersion", String(normalized.schemaVersion)]);
      setting.run(["agentsJson", JSON.stringify(normalized.agents)]);
      setting.free();

      const actor = this.db.prepare(
        "INSERT INTO actors(id, display_name, type, presence, capabilities_json) VALUES (?, ?, ?, ?, ?)"
      );
      for (const item of normalized.actors) {
        actor.run([
          item.id,
          item.displayName,
          item.type,
          item.presence,
          JSON.stringify(item.capabilities)
        ]);
      }
      actor.free();

      const room = this.db.prepare(
        "INSERT INTO rooms(id, name, topic, archived) VALUES (?, ?, ?, ?)"
      );
      const member = this.db.prepare(
        "INSERT INTO room_members(room_id, actor_id, ordinal) VALUES (?, ?, ?)"
      );
      for (const item of normalized.rooms) {
        room.run([item.id, item.name, item.topic, item.archived ? 1 : 0]);
        item.memberIds.forEach((actorId, index) => member.run([item.id, actorId, index]));
      }
      room.free();
      member.free();

      const attachment = this.db.prepare(
        "INSERT INTO attachments(id, actor_id, name, mime_type, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (const item of normalized.attachments) {
        attachment.run([
          item.id,
          item.actorId,
          item.name,
          item.mimeType,
          item.size,
          item.sha256,
          item.createdAt
        ]);
      }
      attachment.free();

      const message = this.db.prepare(
        "INSERT INTO messages(id, room_id, actor_id, timestamp, content, format, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const messageAttachment = this.db.prepare(
        "INSERT INTO message_attachments(message_id, attachment_id, ordinal) VALUES (?, ?, ?)"
      );
      normalized.messages.forEach((item, index) => {
        message.run([
          item.id,
          item.roomId,
          item.actorId,
          item.timestamp,
          item.content,
          item.format,
          index
        ]);
        item.attachmentIds.forEach((attachmentId, attachmentIndex) =>
          messageAttachment.run([item.id, attachmentId, attachmentIndex])
        );
      });
      message.free();
      messageAttachment.free();

      const ledger = this.db.prepare(
        "INSERT INTO ledger(id, timestamp, actor_id, action, target, result, detail, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      normalized.ledger.forEach((item, index) => {
        ledger.run([
          item.id,
          item.timestamp,
          item.actorId,
          item.action,
          item.target ?? null,
          item.result,
          item.detail ?? null,
          index
        ]);
      });
      ledger.free();

      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }

    this.persistBytes();
  }

  private ensureSchema(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actors (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        presence TEXT NOT NULL,
        capabilities_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        topic TEXT NOT NULL,
        archived INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY(room_id, actor_id)
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        content TEXT NOT NULL,
        format TEXT NOT NULL,
        ordinal INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_attachments (
        message_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY(message_id, attachment_id)
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        result TEXT NOT NULL,
        detail TEXT,
        ordinal INTEGER NOT NULL
      );
      PRAGMA user_version = 2;
    `);
    this.persistBytes();
  }

  private persistBytes(): void {
    this.storage.setItem(this.storageKey, bytesToBase64(this.db.export()));
  }
}
