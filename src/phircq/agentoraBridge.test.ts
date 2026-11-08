import { describe, expect, it, vi } from "vitest";
import { createPeerIdentity, signFrame } from "./peerCrypto";
import { readExchangeMessage, EXCHANGE_SCHEMA } from "./agentExchange";
import { deliverVerifiedExchange, readAgentoraPending } from "./agentoraBridge";

const options = {
  baseUrl: "http://127.0.0.1:38771",
  token: "a".repeat(64)
};

async function verifiedPayload() {
  const identity = await createPeerIdentity("peer-btm");
  const message = readExchangeMessage({
    schema: EXCHANGE_SCHEMA,
    messageId: "r4-message-1", threadId: "r4-thread-1",
    sender: "agent:btm", recipient: "agent:overstrings",
    kind: "offer_work",
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    summary: "Inspect an input regression.",
    authority: "advisory-only"
  });
  const signedFrame = await signFrame(identity, {
    kind: "agent.exchange" as const, message
  });
  return {
    peerId: identity.peerId, frameId: signedFrame.id,
    fingerprint: identity.fingerprint, message, signedFrame
  };
}

describe("Agentora loopback bridge", () => {
  it("submits original signed frame, never unsigned agent text", async () => {
    const fake = vi.fn(async (_url, init) => {
      const request = init as RequestInit;
      expect(request.method).toBe("POST");
      expect(request.credentials).toBe("omit");
      const body = JSON.parse(String(request.body));
      expect(body.frame.payload.kind).toBe("agent.exchange");
      expect(body.frame.publicKey).not.toHaveProperty("d");
      expect((request.headers as Record<string, string>).Authorization)
        .toBe("Bearer " + options.token);
      return new Response(JSON.stringify({
        state: "REVIEW_PENDING",
        dispatch_authorized: false, merge_authorized: false,
        outcome_accepted: false
      }), { status: 200 });
    });
    const result = await deliverVerifiedExchange(await verifiedPayload(), {
      ...options, fetchImpl: fake as typeof fetch
    });
    expect(result.state).toBe("REVIEW_PENDING");
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0]?.[0]).toBe("http://127.0.0.1:38771/v1/ingest");
  });

  it("refuses nonlocal endpoints and invalid tokens before any network request", async () => {
    const fake = vi.fn();
    const payload = await verifiedPayload();
    for (const baseUrl of [
      "https://phi-field.com", "http://localhost:38771",
      "http://127.0.0.1:38771.evil.test", "http://127.0.0.1:99999"
    ]) {
      await expect(deliverVerifiedExchange(payload, {
        baseUrl, token: options.token, fetchImpl: fake as typeof fetch
      })).rejects.toThrow("configuration denied");
    }
    await expect(deliverVerifiedExchange(payload, {
      ...options, token: "weak", fetchImpl: fake as typeof fetch
    })).rejects.toThrow("configuration denied");
    expect(fake).not.toHaveBeenCalled();
  });

  it("will not claim delivery on failed response or forged approval", async () => {
    const payload = await verifiedPayload();
    const denied = vi.fn(async () => new Response('{"error":"UNAUTHORIZED"}', { status: 401 }));
    await expect(deliverVerifiedExchange(payload, {
      ...options, fetchImpl: denied as typeof fetch
    })).rejects.toThrow("HTTP 401");
    const unsafe = vi.fn(async () => new Response(JSON.stringify({
      state: "REVIEW_PENDING",
      dispatch_authorized: true, merge_authorized: false,
      outcome_accepted: false
    }), { status: 200 }));
    await expect(deliverVerifiedExchange(payload, {
      ...options, fetchImpl: unsafe as typeof fetch
    })).rejects.toThrow("unsafe acknowledgment");
  });

  it("reads token-protected, nonexecuting inbox status", async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({
      schema: "agentora.agent-exchange.inbox.v1",
      recipient: "agent:overstrings",
      messages: [{
        message_id: "r4-message-1", thread_id: "r4-thread-1",
        sender: "agent:btm", recipient: "agent:overstrings",
        kind: "offer_work", summary: "Inspect input regression",
        context_ref: null, source_sha: null, arrived_at: "2026-11-07T00:00:00Z",
        dispatch_authorized: false, merge_authorized: false, outcome_accepted: false
      }],
      dispatch_authorized: false, merge_authorized: false
    }), { status: 200 }));
    const value = await readAgentoraPending("agent:overstrings", {
      ...options, fetchImpl: fake as typeof fetch
    });
    expect(value.messages).toHaveLength(1);
    expect(value.messages[0]?.summary).toMatch(/Inspect/);
    expect(fake.mock.calls[0]?.[0]).toContain("recipient=agent%3Aoverstrings");
  });
});
