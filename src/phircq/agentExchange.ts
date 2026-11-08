import { MemoryTransport } from "./transport";

// Deliberately mirrors Commonline's independent advisory sidecar wire contract.
// No production peer adapter is allowed to skip PHircQ's signed-session trust gate.
export const EXCHANGE_SCHEMA = "commonline.agent-exchange.v1" as const;
export const EXCHANGE_EVENT = "commonline.agent_exchange.v1" as const;

export type ExchangeKind = "offer_work" | "accept_work" | "decline_work"
  | "request_context" | "propose_outcome" | "report_blocker" | "receipt";

export interface ExchangeMessage {
  schema: typeof EXCHANGE_SCHEMA;
  messageId: string;
  threadId: string;
  sender: string;
  recipient: string;
  kind: ExchangeKind;
  issuedAt: string;
  expiresAt: string;
  summary: string;
  contextRef?: string;
  sourceSha?: string;
  authority: "advisory-only";
}

const KINDS = new Set(["offer_work", "accept_work", "decline_work",
  "request_context", "propose_outcome", "report_blocker", "receipt"]);
const REQUIRED = ["schema", "messageId", "threadId", "sender", "recipient",
  "kind", "issuedAt", "expiresAt", "summary", "authority"];
const FIELDS = new Set([...REQUIRED, "contextRef", "sourceSha"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function validTime(value: unknown): number {
  if (typeof value !== "string") throw new Error("TIME_INVALID");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("TIME_INVALID");
  }
  return parsed;
}

export function readExchangeMessage(input: unknown, nowMs: number = Date.now()): ExchangeMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID");
  const value = input as Record<string, unknown>;
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error("INVALID"); }
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > 8192) {
    throw new Error("TOO_LARGE");
  }
  if (Object.keys(value).some((key) => !FIELDS.has(key)) ||
      REQUIRED.some((key) => !Object.hasOwn(value, key))) throw new Error("FIELDS_INVALID");
  if (value.schema !== EXCHANGE_SCHEMA || !KINDS.has(String(value.kind)) ||
      value.authority !== "advisory-only") throw new Error("SCHEMA_OR_AUTHORITY_INVALID");
  for (const field of ["messageId", "threadId", "sender", "recipient"]) {
    if (typeof value[field] !== "string" || !ID.test(value[field])) throw new Error("IDENTITY_INVALID");
  }
  if (value.sender === value.recipient) throw new Error("SELF_DELIVERY_FORBIDDEN");
  if (typeof value.summary !== "string" || !value.summary.trim() ||
      value.summary.length > 2048) throw new Error("SUMMARY_INVALID");
  if (value.contextRef !== undefined &&
      (typeof value.contextRef !== "string" || !value.contextRef.trim() ||
       value.contextRef.length > 512)) throw new Error("CONTEXT_INVALID");
  if (value.sourceSha !== undefined &&
      (typeof value.sourceSha !== "string" || !SHA.test(value.sourceSha))) {
    throw new Error("SHA_INVALID");
  }
  const issued = validTime(value.issuedAt);
  const expires = validTime(value.expiresAt);
  if (!Number.isFinite(nowMs) || issued > nowMs + 300000 ||
      expires <= nowMs || expires <= issued || expires - issued > 86400000) {
    throw new Error("EXPIRED_OR_STALE");
  }
  return Object.freeze({
    schema: EXCHANGE_SCHEMA,
    messageId: value.messageId as string,
    threadId: value.threadId as string,
    sender: value.sender as string,
    recipient: value.recipient as string,
    kind: value.kind as ExchangeKind,
    issuedAt: value.issuedAt as string,
    expiresAt: value.expiresAt as string,
    summary: value.summary as string,
    ...(value.contextRef === undefined ? {} : { contextRef: value.contextRef as string }),
    ...(value.sourceSha === undefined ? {} : { sourceSha: value.sourceSha as string }),
    authority: "advisory-only" as const
  });
}

/**
 * Test-only in-memory pilot: two explicitly paired agent identities.
 * It cannot accept arbitrary WebRTC/remote transports; production delivery
 * must authenticate a signed PHircQ PeerSession BEFORE invoking a bridge.
 * The callback receives untrusted text, not a tool invocation or permission.
 */
export function openLocalAgentExchange(input: {
  transport: MemoryTransport;
  selfAgent: string;
  allowedPeerAgent: string;
  onMessage: (message: ExchangeMessage) => void;
  now?: () => number;
}) {
  if (!(input.transport instanceof MemoryTransport)) throw new Error("MEMORY_ONLY");
  if (!ID.test(input.selfAgent) || !ID.test(input.allowedPeerAgent) ||
      input.selfAgent === input.allowedPeerAgent) throw new Error("PEER_CONFIGURATION_INVALID");
  const now = input.now ?? Date.now;
  const seen = new Set<string>();
  const recent: string[] = [];
  const stop = input.transport.subscribe((event) => {
    if (event.type !== EXCHANGE_EVENT) return;
    let message: ExchangeMessage;
    try { message = readExchangeMessage(event.payload, now()); } catch { return; }
    if (message.sender !== input.allowedPeerAgent || message.recipient !== input.selfAgent ||
        seen.has(message.messageId)) return;
    seen.add(message.messageId);
    recent.push(message.messageId);
    if (recent.length > 512) seen.delete(recent.shift()!);
    input.onMessage(message);
  });
  return {
    async send(value: unknown): Promise<void> {
      const message = readExchangeMessage(value, now());
      if (message.sender !== input.selfAgent || message.recipient !== input.allowedPeerAgent) {
        throw new Error("ROUTE_DENIED");
      }
      await input.transport.send({ type: EXCHANGE_EVENT, payload: message });
    },
    close(): void { stop(); }
  };
}
