import {
  createPeerIdentity,
  fingerprintPublicKey,
  ReplayWindow,
  signFrame,
  verifyFrame,
  type PeerIdentity,
  type SignedFrame
} from "./peerCrypto";
import type { PeerTrust } from "./types";
import type { Transport } from "./transport";

export interface ChatFramePayload {
  kind: "chat.message";
  roomName: string;
  displayName: string;
  text: string;
}

export interface PeerSessionHandlers {
  onUntrustedPeer?: (request: {
    peerId: string;
    displayName: string;
    fingerprint: string;
  }) => void;
  onChat?: (message: {
    peerId: string;
    displayName: string;
    roomName: string;
    text: string;
    frameId: string;
  }) => void;
  onRejected?: (reason: string) => void;
}

export class PeerSession {
  private readonly replay = new ReplayWindow();
  private readonly unsubscribe: () => void;

  private constructor(
    readonly identity: PeerIdentity,
    private readonly transport: Transport,
    private readonly trusts: () => PeerTrust[],
    private readonly handlers: PeerSessionHandlers
  ) {
    this.unsubscribe = transport.subscribe((event) => {
      if (event.type !== "peer.signed-frame") return;
      void this.receive(event.payload as SignedFrame<ChatFramePayload>);
    });
  }

  static async create(options: {
    peerId: string;
    transport: Transport;
    trusts: () => PeerTrust[];
    handlers?: PeerSessionHandlers;
  }): Promise<PeerSession> {
    return new PeerSession(
      await createPeerIdentity(options.peerId),
      options.transport,
      options.trusts,
      options.handlers ?? {}
    );
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async disconnect(): Promise<void> {
    this.unsubscribe();
    await this.transport.disconnect();
  }

  async sendChat(input: {
    roomName: string;
    displayName: string;
    text: string;
  }): Promise<void> {
    const frame = await signFrame<ChatFramePayload>(this.identity, {
      kind: "chat.message",
      roomName: input.roomName,
      displayName: input.displayName,
      text: input.text
    });

    await this.transport.send({
      type: "peer.signed-frame",
      payload: frame
    });
  }

  private async receive(frame: SignedFrame<ChatFramePayload>): Promise<void> {
    if (!frame || typeof frame.id !== "string" || typeof frame.peerId !== "string") {
      this.handlers.onRejected?.("malformed frame");
      return;
    }

    if (!this.replay.accept(frame.id)) {
      this.handlers.onRejected?.("replay rejected");
      return;
    }

    const signatureOk = await verifyFrame(frame);
    if (!signatureOk) {
      this.handlers.onRejected?.("signature rejected");
      return;
    }

    const fingerprint = await fingerprintPublicKey(frame.publicKey);
    const trust = this.trusts().find((item) => item.peerId === frame.peerId);

    if (!trust) {
      this.handlers.onUntrustedPeer?.({
        peerId: frame.peerId,
        displayName:
          frame.payload?.kind === "chat.message" ? frame.payload.displayName : frame.peerId,
        fingerprint
      });
      return;
    }

    if (trust.fingerprint !== fingerprint) {
      this.handlers.onRejected?.("trusted peer key mismatch");
      return;
    }

    if (
      frame.payload?.kind !== "chat.message" ||
      typeof frame.payload.roomName !== "string" ||
      typeof frame.payload.displayName !== "string" ||
      typeof frame.payload.text !== "string"
    ) {
      this.handlers.onRejected?.("unsupported payload");
      return;
    }

    this.handlers.onChat?.({
      peerId: frame.peerId,
      displayName: frame.payload.displayName,
      roomName: frame.payload.roomName,
      text: frame.payload.text,
      frameId: frame.id
    });
  }
}
