/** Explicit local PHircQ -> Agentora delivery of verified signed frames.
 * Token is operator-provided per session. Never persist, log, or put in a URL.
 * A signed message is NOT an execution grant.
 */
import {
  serializeSignedExchangeBundle,
  type SignedExchangeReceived
} from "./agentExchangeBundle";

export interface AgentoraBridgeOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface BridgeImportResult {
  state: "REVIEW_PENDING" | "REPLAY_IGNORED";
  dispatch_authorized: false;
  merge_authorized: false;
  outcome_accepted: false;
}

export interface BridgeInbox {
  schema: "agentora.agent-exchange.inbox.v1";
  recipient: string;
  messages: Array<{
    message_id: string;
    thread_id: string;
    sender: string;
    recipient: string;
    kind: string;
    summary: string;
    context_ref: string | null;
    source_sha: string | null;
    arrived_at: string;
    dispatch_authorized: false;
    merge_authorized: false;
    outcome_accepted: false;
  }>;
  dispatch_authorized: false;
  merge_authorized: false;
}

const HEX_TOKEN = /^[a-f0-9]{64}$/;
const LOOPBACK_BASE = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function bridge(options: AgentoraBridgeOptions) {
  // Never let a public/LAN-loaded PHircQ page solicit and forward local secrets.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (!["localhost", "127.0.0.1", "tauri.localhost"].includes(host) &&
        window.location.protocol !== "tauri:") {
      throw new Error("Agentora bridge requires a trusted local PHircQ origin.");
    }
  }
  const url = options.baseUrl.replace(/\/$/, "");
  const match = LOOPBACK_BASE.exec(url);
  if (!match || Number(match[1]) > 65535 || !HEX_TOKEN.test(options.token)) {
    throw new Error("Agentora local bridge configuration denied.");
  }
  return { url, fetchImpl: options.fetchImpl ?? fetch };
}

async function checkedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error("Agentora bridge returned HTTP " + response.status + ".");
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Agentora bridge response malformed.");
  }
  return body as Record<string, unknown>;
}

/** Invoke only from a trusted PeerSession.onAgentExchange callback. */
export async function deliverVerifiedExchange(
  received: SignedExchangeReceived,
  options: AgentoraBridgeOptions
): Promise<BridgeImportResult> {
  const local = bridge(options);
  const bundle = serializeSignedExchangeBundle(received);
  const response = await local.fetchImpl(local.url + "/v1/ingest", {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + options.token
    },
    body: bundle
  });
  const payload = await checkedJson(response);
  if (!["REVIEW_PENDING", "REPLAY_IGNORED"].includes(String(payload.state)) ||
      payload.dispatch_authorized !== false ||
      payload.merge_authorized !== false ||
      payload.outcome_accepted !== false) {
    throw new Error("Agentora bridge returned an unsafe acknowledgment.");
  }
  return payload as unknown as BridgeImportResult;
}

/** Read-only operator inbox view. Reading is NOT acceptance or execution. */
export async function readAgentoraPending(
  recipient: string,
  options: AgentoraBridgeOptions
): Promise<BridgeInbox> {
  const local = bridge(options);
  if (!ID.test(recipient)) throw new Error("Recipient ID invalid.");
  const response = await local.fetchImpl(
    local.url + "/v1/pending?recipient=" + encodeURIComponent(recipient),
    {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: "Bearer " + options.token }
    }
  );
  const payload = await checkedJson(response);
  if (payload.schema !== "agentora.agent-exchange.inbox.v1" ||
      payload.recipient !== recipient || !Array.isArray(payload.messages) ||
      payload.dispatch_authorized !== false ||
      payload.merge_authorized !== false ||
      payload.messages.length > 100 ||
      payload.messages.some((message: unknown) =>
        !message || typeof message !== "object" ||
        (message as Record<string, unknown>).dispatch_authorized !== false ||
        (message as Record<string, unknown>).merge_authorized !== false ||
        (message as Record<string, unknown>).outcome_accepted !== false)) {
    throw new Error("Agentora bridge returned malformed or unsafe inbox.");
  }
  return payload as unknown as BridgeInbox;
}
