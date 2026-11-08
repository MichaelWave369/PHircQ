/** Portable handoff data for separately verified PHircQ -> Agentora import.
 *
 * This serializer is NOT a verifier. Only call it with onAgentExchange's
 * already authenticated PeerSession callback payload. Agentora independently
 * checks the frame signature and an operator-pinned peer/agent binding.
 */
import { readExchangeMessage, type ExchangeMessage } from "./agentExchange";
import type { SignedFrame } from "./peerCrypto";
import type { PeerFramePayload } from "./peerSession";

export const SIGNED_EXCHANGE_BUNDLE_SCHEMA =
  "phircq.agent-exchange.signed-bundle.v1" as const;

export interface SignedExchangeReceived {
  peerId: string;
  frameId: string;
  fingerprint: string;
  message: ExchangeMessage;
  signedFrame: SignedFrame<PeerFramePayload>;
}

/** Nothing here contains secrets or an authorization to execute. */
export function serializeSignedExchangeBundle(received: SignedExchangeReceived): string {
  const frame = received.signedFrame;
  if (frame.peerId !== received.peerId || frame.id !== received.frameId ||
      frame.payload?.kind !== "agent.exchange") {
    throw new Error("Signed exchange frame does not match the received identity.");
  }
  const fromFrame = readExchangeMessage(frame.payload.message);
  const receivedMessage = readExchangeMessage(received.message);
  if (JSON.stringify(fromFrame) !== JSON.stringify(receivedMessage)) {
    throw new Error("Signed frame and delivered message disagree.");
  }
  // Keep the signed frame exactly as received, including insertion-order fields.
  // Reordering its payload keys after signature generation invalidates the proof.
  const bundle = {
    schema: SIGNED_EXCHANGE_BUNDLE_SCHEMA,
    frame
  };
  const json = JSON.stringify(bundle);
  if (new TextEncoder().encode(json).byteLength > 16384) {
    throw new Error("Signed exchange bundle exceeds limit.");
  }
  return json;
}
