import { createPeerIdentity, fingerprintPublicKey, type PeerIdentity } from "./peerCrypto";
import { PeerSession, type PeerSessionHandlers } from "./peerSession";
import type { PeerTrust } from "./types";
import { WebRtcTransport } from "./transport";

export const PAPER_SIGNAL_SCHEMA = "phircq.paper.v1" as const;

export interface PaperPeerDescriptor {
  peerId: string;
  displayName: string;
  publicKey: JsonWebKey;
  fingerprint: string;
}

export interface PaperSignal {
  schema: typeof PAPER_SIGNAL_SCHEMA;
  kind: "offer" | "answer";
  sessionId: string;
  from: PaperPeerDescriptor;
  description: RTCSessionDescriptionInit;
}

export type PaperRole = "offerer" | "answerer";

function localDescription(peer: RTCPeerConnection): RTCSessionDescriptionInit {
  if (!peer.localDescription) throw new Error("Local WebRTC description is missing.");
  return {
    type: peer.localDescription.type,
    sdp: peer.localDescription.sdp
  };
}

async function waitForIceComplete(
  peer: RTCPeerConnection,
  timeoutMs = 10000
): Promise<void> {
  if (peer.iceGatheringState === "complete") return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for local ICE gathering."));
    }, timeoutMs);

    const onChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onChange);
    };

    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

function waitForDataChannel(peer: RTCPeerConnection): Promise<RTCDataChannel> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for PHircQ data channel."));
    }, 15000);

    const onChannel = (event: RTCDataChannelEvent) => {
      cleanup();
      resolve(event.channel);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      peer.removeEventListener("datachannel", onChannel);
    };

    peer.addEventListener("datachannel", onChannel);
  });
}

export function encodePaperSignal(signal: PaperSignal): string {
  return JSON.stringify(signal, null, 2);
}

export async function decodePaperSignal(
  encoded: string,
  expectedKind?: PaperSignal["kind"]
): Promise<PaperSignal> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("Paper Link signal is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Paper Link signal is malformed.");
  }

  const signal = parsed as Partial<PaperSignal>;

  if (
    signal.schema !== PAPER_SIGNAL_SCHEMA ||
    (signal.kind !== "offer" && signal.kind !== "answer") ||
    typeof signal.sessionId !== "string" ||
    !signal.sessionId ||
    !signal.from ||
    typeof signal.from.peerId !== "string" ||
    typeof signal.from.displayName !== "string" ||
    typeof signal.from.fingerprint !== "string" ||
    !signal.from.publicKey ||
    !signal.description ||
    (signal.description.type !== "offer" &&
      signal.description.type !== "answer") ||
    typeof signal.description.sdp !== "string"
  ) {
    throw new Error("Paper Link signal has an invalid schema.");
  }

  if (expectedKind && signal.kind !== expectedKind) {
    throw new Error(
      `Expected a Paper Link ${expectedKind}, received ${signal.kind}.`
    );
  }

  if (signal.description.type !== signal.kind) {
    throw new Error("Paper Link kind does not match its SDP description.");
  }

  const actualFingerprint = await fingerprintPublicKey(signal.from.publicKey);

  if (actualFingerprint !== signal.from.fingerprint) {
    throw new Error(
      "Paper Link identity fingerprint does not match its public key."
    );
  }

  return signal as PaperSignal;
}

async function describeIdentity(
  identity: PeerIdentity,
  displayName: string
): Promise<PaperPeerDescriptor> {
  return {
    peerId: identity.peerId,
    displayName,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint
  };
}

export class PaperLinkEndpoint {
  private remote?: PaperPeerDescriptor;
  private session?: PeerSession;

  private constructor(
    readonly role: PaperRole,
    readonly sessionId: string,
    readonly identity: PeerIdentity,
    readonly localSignal: PaperSignal,
    readonly peer: RTCPeerConnection,
    private readonly channelPromise: Promise<RTCDataChannel>
  ) {}

  static async createOffer(input: {
    peerId: string;
    displayName: string;
  }): Promise<PaperLinkEndpoint> {
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("WebRTC is unavailable in this browser.");
    }

    const sessionId = crypto.randomUUID();
    const identity = await createPeerIdentity(input.peerId);
    const peer = new RTCPeerConnection({ iceServers: [] });
    const channel = peer.createDataChannel("phircq", { ordered: true });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceComplete(peer);

    const localSignal: PaperSignal = {
      schema: PAPER_SIGNAL_SCHEMA,
      kind: "offer",
      sessionId,
      from: await describeIdentity(identity, input.displayName),
      description: localDescription(peer)
    };

    return new PaperLinkEndpoint(
      "offerer",
      sessionId,
      identity,
      localSignal,
      peer,
      Promise.resolve(channel)
    );
  }

  static async acceptOffer(
    encodedOffer: string,
    input: {
      peerId: string;
      displayName: string;
    }
  ): Promise<PaperLinkEndpoint> {
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("WebRTC is unavailable in this browser.");
    }

    const offer = await decodePaperSignal(encodedOffer, "offer");
    const identity = await createPeerIdentity(input.peerId);
    const peer = new RTCPeerConnection({ iceServers: [] });
    const channelPromise = waitForDataChannel(peer);

    await peer.setRemoteDescription(offer.description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIceComplete(peer);

    const localSignal: PaperSignal = {
      schema: PAPER_SIGNAL_SCHEMA,
      kind: "answer",
      sessionId: offer.sessionId,
      from: await describeIdentity(identity, input.displayName),
      description: localDescription(peer)
    };

    const endpoint = new PaperLinkEndpoint(
      "answerer",
      offer.sessionId,
      identity,
      localSignal,
      peer,
      channelPromise
    );

    endpoint.remote = offer.from;
    return endpoint;
  }

  get remotePeer(): PaperPeerDescriptor | undefined {
    return this.remote ? structuredClone(this.remote) : undefined;
  }

  async applyAnswer(encodedAnswer: string): Promise<PaperPeerDescriptor> {
    if (this.role !== "offerer") {
      throw new Error("Only the offerer can apply a Paper Link answer.");
    }

    const answer = await decodePaperSignal(encodedAnswer, "answer");

    if (answer.sessionId !== this.sessionId) {
      throw new Error("Paper Link answer belongs to a different session.");
    }

    await this.peer.setRemoteDescription(answer.description);
    this.remote = answer.from;
    return structuredClone(answer.from);
  }

  async connectSession(options: {
    trusts: () => PeerTrust[];
    handlers?: PeerSessionHandlers;
  }): Promise<PeerSession> {
    if (!this.remote) {
      throw new Error("Remote Paper Link identity is not known yet.");
    }

    if (this.session) return this.session;

    const channel = await this.channelPromise;
    const transport = new WebRtcTransport(
      `paper-${this.sessionId}-${this.role}`,
      channel
    );

    this.session = await PeerSession.create({
      peerId: this.identity.peerId,
      identity: this.identity,
      transport,
      trusts: options.trusts,
      handlers: options.handlers
    });

    await this.session.connect();
    return this.session;
  }

  async close(): Promise<void> {
    if (this.session) {
      try {
        await this.session.disconnect();
      } catch {
        // Continue closing the peer connection if the channel already raced closed.
      }
      this.session = undefined;
    }

    this.peer.close();
  }
}
