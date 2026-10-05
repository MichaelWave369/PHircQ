export type ActorType = "HUMAN" | "AGENT" | "BOT" | "SERVICE" | "SYSTEM" | "REMOTE_PEER";
export type Presence = "ONLINE" | "AWAY" | "BUSY" | "OFFLINE" | "INVISIBLE" | "AGENT_IDLE" | "AGENT_WORKING";

export interface Actor {
  id: string;
  displayName: string;
  type: ActorType;
  presence: Presence;
  capabilities: string[];
}

export interface Room {
  id: string;
  name: string;
  topic: string;
  memberIds: string[];
  archived: boolean;
}

export interface AttachmentMeta {
  id: string;
  actorId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface Message {
  id: string;
  roomId: string;
  actorId: string;
  timestamp: string;
  content: string;
  format: "text" | "action" | "system";
  attachmentIds: string[];
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  target?: string;
  result: "ALLOW" | "DENY";
  detail?: string;
}

export interface RuntimeSnapshot {
  schemaVersion: number;
  selfId: string;
  currentRoomId: string;
  actors: Actor[];
  rooms: Room[];
  messages: Message[];
  ledger: LedgerEntry[];
  attachments: AttachmentMeta[];
}

export interface Action {
  actorId: string;
  type: string;
  target?: string;
  payload?: unknown;
}
