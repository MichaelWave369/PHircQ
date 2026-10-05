import { sha256Hex } from "./attachments";
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

export const PEER_FILE_CHUNK_BYTES = 12 * 1024;
export const MAX_PEER_FILE_BYTES = 25 * 1024 * 1024;

export interface ChatFramePayload {
  kind: "chat.message";
  roomName: string;
  displayName: string;
  text: string;
}

export interface FileOfferPayload {
  kind: "file.offer";
  transferId: string;
  roomName: string;
  displayName: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  chunkSize: number;
  totalChunks: number;
}

export interface FileAcceptPayload {
  kind: "file.accept";
  transferId: string;
}

export interface FileRejectPayload {
  kind: "file.reject";
  transferId: string;
  reason: string;
}

export interface FileChunkPayload {
  kind: "file.chunk";
  transferId: string;
  index: number;
  data: string;
}

export interface FileCompletePayload {
  kind: "file.complete";
  transferId: string;
}

export interface FileReceiptPayload {
  kind: "file.receipt";
  transferId: string;
  ok: boolean;
  detail: string;
}

export type PeerFramePayload =
  | ChatFramePayload
  | FileOfferPayload
  | FileAcceptPayload
  | FileRejectPayload
  | FileChunkPayload
  | FileCompletePayload
  | FileReceiptPayload;

export interface IncomingFileOffer {
  peerId: string;
  fingerprint: string;
  offer: FileOfferPayload;
}

export interface ReceivedPeerFile {
  peerId: string;
  displayName: string;
  roomName: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  blob: Blob;
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
  onFileOffer?: (offer: IncomingFileOffer) => void;
  onFileProgress?: (progress: {
    transferId: string;
    direction: "send" | "receive";
    completedBytes: number;
    totalBytes: number;
  }) => void;
  onFileReceived?: (file: ReceivedPeerFile) => void | Promise<void>;
  onFileStatus?: (status: {
    transferId: string;
    status: "offered" | "accepted" | "rejected" | "sending" | "sent" | "received" | "failed";
    detail?: string;
  }) => void;
  onRejected?: (reason: string) => void;
}

interface OutgoingTransfer {
  file: Blob;
  offer: FileOfferPayload;
  sending: boolean;
}

interface IncomingTransfer {
  peerId: string;
  displayName: string;
  offer: FileOfferPayload;
  accepted: boolean;
  chunks: Array<Uint8Array | undefined>;
  receivedBytes: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
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

function safeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 128 || /[\\/\0]/.test(trimmed)) {
    throw new Error("Peer file name is invalid.");
  }
  return trimmed;
}

function payloadDisplayName(payload: PeerFramePayload, fallback: string): string {
  if (payload.kind === "chat.message" || payload.kind === "file.offer") {
    return payload.displayName;
  }
  return fallback;
}

export class PeerSession {
  private readonly replay = new ReplayWindow();
  private readonly unsubscribe: () => void;
  private readonly outgoing = new Map<string, OutgoingTransfer>();
  private readonly incoming = new Map<string, IncomingTransfer>();

  private constructor(
    readonly identity: PeerIdentity,
    private readonly transport: Transport,
    private readonly trusts: () => PeerTrust[],
    private readonly handlers: PeerSessionHandlers
  ) {
    this.unsubscribe = transport.subscribe((event) => {
      if (event.type !== "peer.signed-frame") return;
      void this.receive(event.payload as SignedFrame<PeerFramePayload>);
    });
  }

  static async create(options: {
    peerId: string;
    identity?: PeerIdentity;
    transport: Transport;
    trusts: () => PeerTrust[];
    handlers?: PeerSessionHandlers;
  }): Promise<PeerSession> {
    return new PeerSession(
      options.identity ?? (await createPeerIdentity(options.peerId)),
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
    this.outgoing.clear();
    this.incoming.clear();
    await this.transport.disconnect();
  }

  async sendChat(input: {
    roomName: string;
    displayName: string;
    text: string;
  }): Promise<void> {
    await this.sendSigned({
      kind: "chat.message",
      roomName: input.roomName,
      displayName: input.displayName,
      text: input.text
    });
  }

  async offerFile(input: {
    file: Blob;
    name: string;
    mimeType?: string;
    roomName: string;
    displayName: string;
  }): Promise<FileOfferPayload> {
    if (input.file.size > MAX_PEER_FILE_BYTES) {
      throw new Error(`Peer file exceeds ${MAX_PEER_FILE_BYTES} byte limit.`);
    }

    const name = safeFileName(input.name);
    const transferId = crypto.randomUUID();
    const offer: FileOfferPayload = {
      kind: "file.offer",
      transferId,
      roomName: input.roomName,
      displayName: input.displayName,
      name,
      mimeType: input.mimeType || input.file.type || "application/octet-stream",
      size: input.file.size,
      sha256: await sha256Hex(input.file),
      chunkSize: PEER_FILE_CHUNK_BYTES,
      totalChunks: Math.ceil(input.file.size / PEER_FILE_CHUNK_BYTES)
    };

    this.outgoing.set(transferId, {
      file: input.file,
      offer,
      sending: false
    });

    await this.sendSigned(offer);
    this.handlers.onFileStatus?.({
      transferId,
      status: "offered",
      detail: `${name} · ${input.file.size} bytes`
    });
    return offer;
  }

  async acceptFile(transferId: string): Promise<void> {
    const transfer = this.incoming.get(transferId);
    if (!transfer) throw new Error("Incoming peer file offer was not found.");

    transfer.accepted = true;
    await this.sendSigned({
      kind: "file.accept",
      transferId
    });
    this.handlers.onFileStatus?.({
      transferId,
      status: "accepted",
      detail: transfer.offer.name
    });
  }

  async rejectFile(transferId: string, reason = "operator declined"): Promise<void> {
    const transfer = this.incoming.get(transferId);
    if (!transfer) throw new Error("Incoming peer file offer was not found.");

    this.incoming.delete(transferId);
    await this.sendSigned({
      kind: "file.reject",
      transferId,
      reason
    });
    this.handlers.onFileStatus?.({
      transferId,
      status: "rejected",
      detail: reason
    });
  }

  private async sendSigned(payload: PeerFramePayload): Promise<void> {
    const frame = await signFrame<PeerFramePayload>(this.identity, payload);
    await this.transport.send({
      type: "peer.signed-frame",
      payload: frame
    });
  }

  private async streamOutgoing(transferId: string): Promise<void> {
    const transfer = this.outgoing.get(transferId);
    if (!transfer || transfer.sending) return;

    transfer.sending = true;
    this.handlers.onFileStatus?.({
      transferId,
      status: "sending",
      detail: transfer.offer.name
    });

    try {
      for (let index = 0; index < transfer.offer.totalChunks; index += 1) {
        const start = index * transfer.offer.chunkSize;
        const end = Math.min(start + transfer.offer.chunkSize, transfer.file.size);
        const bytes = new Uint8Array(
          await transfer.file.slice(start, end).arrayBuffer()
        );

        await this.transport.drain();
        await this.sendSigned({
          kind: "file.chunk",
          transferId,
          index,
          data: bytesToBase64(bytes)
        });

        this.handlers.onFileProgress?.({
          transferId,
          direction: "send",
          completedBytes: end,
          totalBytes: transfer.file.size
        });
      }

      await this.transport.drain();
      await this.sendSigned({
        kind: "file.complete",
        transferId
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "peer file send failed";
      this.handlers.onFileStatus?.({
        transferId,
        status: "failed",
        detail
      });
      throw error;
    }
  }

  private async receive(frame: SignedFrame<PeerFramePayload>): Promise<void> {
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
        displayName: payloadDisplayName(frame.payload, frame.peerId),
        fingerprint
      });
      return;
    }

    if (trust.fingerprint !== fingerprint) {
      this.handlers.onRejected?.("trusted peer key mismatch");
      return;
    }

    switch (frame.payload?.kind) {
      case "chat.message":
        if (
          typeof frame.payload.roomName !== "string" ||
          typeof frame.payload.displayName !== "string" ||
          typeof frame.payload.text !== "string"
        ) {
          this.handlers.onRejected?.("malformed chat payload");
          return;
        }

        this.handlers.onChat?.({
          peerId: frame.peerId,
          displayName: frame.payload.displayName,
          roomName: frame.payload.roomName,
          text: frame.payload.text,
          frameId: frame.id
        });
        return;

      case "file.offer":
        await this.receiveFileOffer(frame.peerId, fingerprint, frame.payload);
        return;

      case "file.accept":
        if (typeof frame.payload.transferId !== "string") {
          this.handlers.onRejected?.("malformed file acceptance");
          return;
        }
        this.handlers.onFileStatus?.({
          transferId: frame.payload.transferId,
          status: "accepted"
        });
        void this.streamOutgoing(frame.payload.transferId);
        return;

      case "file.reject":
        if (
          typeof frame.payload.transferId !== "string" ||
          typeof frame.payload.reason !== "string"
        ) {
          this.handlers.onRejected?.("malformed file rejection");
          return;
        }
        this.outgoing.delete(frame.payload.transferId);
        this.handlers.onFileStatus?.({
          transferId: frame.payload.transferId,
          status: "rejected",
          detail: frame.payload.reason
        });
        return;

      case "file.chunk":
        await this.receiveFileChunk(frame.peerId, frame.payload);
        return;

      case "file.complete":
        await this.completeIncomingFile(frame.peerId, frame.payload.transferId);
        return;

      case "file.receipt":
        if (
          typeof frame.payload.transferId !== "string" ||
          typeof frame.payload.ok !== "boolean" ||
          typeof frame.payload.detail !== "string"
        ) {
          this.handlers.onRejected?.("malformed file receipt");
          return;
        }
        this.outgoing.delete(frame.payload.transferId);
        this.handlers.onFileStatus?.({
          transferId: frame.payload.transferId,
          status: frame.payload.ok ? "sent" : "failed",
          detail: frame.payload.detail
        });
        return;

      default:
        this.handlers.onRejected?.("unsupported payload");
    }
  }

  private async receiveFileOffer(
    peerId: string,
    fingerprint: string,
    offer: FileOfferPayload
  ): Promise<void> {
    try {
      safeFileName(offer.name);
    } catch (error) {
      this.handlers.onRejected?.(
        error instanceof Error ? error.message : "invalid peer file name"
      );
      return;
    }

    if (
      typeof offer.transferId !== "string" ||
      !offer.transferId ||
      typeof offer.roomName !== "string" ||
      typeof offer.displayName !== "string" ||
      typeof offer.mimeType !== "string" ||
      !Number.isSafeInteger(offer.size) ||
      offer.size < 0 ||
      offer.size > MAX_PEER_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(offer.sha256) ||
      offer.chunkSize !== PEER_FILE_CHUNK_BYTES ||
      offer.totalChunks !== Math.ceil(offer.size / PEER_FILE_CHUNK_BYTES)
    ) {
      this.handlers.onRejected?.("malformed peer file offer");
      return;
    }

    if (this.incoming.has(offer.transferId)) {
      this.handlers.onRejected?.("duplicate peer file offer");
      return;
    }

    this.incoming.set(offer.transferId, {
      peerId,
      displayName: offer.displayName,
      offer,
      accepted: false,
      chunks: new Array(offer.totalChunks),
      receivedBytes: 0
    });

    this.handlers.onFileOffer?.({
      peerId,
      fingerprint,
      offer
    });
  }

  private async receiveFileChunk(
    peerId: string,
    payload: FileChunkPayload
  ): Promise<void> {
    const transfer = this.incoming.get(payload.transferId);

    if (!transfer || transfer.peerId !== peerId || !transfer.accepted) {
      this.handlers.onRejected?.("file chunk without accepted offer");
      return;
    }

    if (
      !Number.isSafeInteger(payload.index) ||
      payload.index < 0 ||
      payload.index >= transfer.offer.totalChunks ||
      typeof payload.data !== "string"
    ) {
      this.handlers.onRejected?.("malformed file chunk");
      return;
    }

    if (transfer.chunks[payload.index]) {
      this.handlers.onRejected?.("duplicate file chunk");
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(payload.data);
    } catch {
      this.handlers.onRejected?.("invalid file chunk encoding");
      return;
    }

    if (bytes.byteLength > transfer.offer.chunkSize) {
      this.handlers.onRejected?.("file chunk exceeds negotiated size");
      return;
    }

    const expectedStart = payload.index * transfer.offer.chunkSize;
    const expectedEnd = Math.min(
      expectedStart + transfer.offer.chunkSize,
      transfer.offer.size
    );
    if (bytes.byteLength !== expectedEnd - expectedStart) {
      this.handlers.onRejected?.("file chunk byte count mismatch");
      return;
    }

    transfer.chunks[payload.index] = bytes;
    transfer.receivedBytes += bytes.byteLength;

    if (transfer.receivedBytes > transfer.offer.size) {
      this.incoming.delete(payload.transferId);
      this.handlers.onRejected?.("peer file exceeded declared size");
      return;
    }

    this.handlers.onFileProgress?.({
      transferId: payload.transferId,
      direction: "receive",
      completedBytes: transfer.receivedBytes,
      totalBytes: transfer.offer.size
    });
  }

  private async completeIncomingFile(
    peerId: string,
    transferId: string
  ): Promise<void> {
    const transfer = this.incoming.get(transferId);

    if (!transfer || transfer.peerId !== peerId || !transfer.accepted) {
      this.handlers.onRejected?.("file completion without accepted offer");
      return;
    }

    if (
      transfer.receivedBytes !== transfer.offer.size ||
      transfer.chunks.some((chunk) => !chunk)
    ) {
      await this.sendSigned({
        kind: "file.receipt",
        transferId,
        ok: false,
        detail: "missing chunks"
      });
      this.handlers.onFileStatus?.({
        transferId,
        status: "failed",
        detail: "missing chunks"
      });
      return;
    }

    const blob = new Blob(
      transfer.chunks as Uint8Array[],
      { type: transfer.offer.mimeType }
    );
    const actualHash = await sha256Hex(blob);

    if (actualHash !== transfer.offer.sha256) {
      this.incoming.delete(transferId);
      await this.sendSigned({
        kind: "file.receipt",
        transferId,
        ok: false,
        detail: "sha256 mismatch"
      });
      this.handlers.onFileStatus?.({
        transferId,
        status: "failed",
        detail: "sha256 mismatch"
      });
      return;
    }

    try {
      await this.handlers.onFileReceived?.({
        peerId,
        displayName: transfer.displayName,
        roomName: transfer.offer.roomName,
        transferId,
        name: transfer.offer.name,
        mimeType: transfer.offer.mimeType,
        size: transfer.offer.size,
        sha256: transfer.offer.sha256,
        blob
      });

      this.incoming.delete(transferId);
      await this.sendSigned({
        kind: "file.receipt",
        transferId,
        ok: true,
        detail: "sha256 verified and receiver accepted bytes"
      });
      this.handlers.onFileStatus?.({
        transferId,
        status: "received",
        detail: transfer.offer.name
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "receiver rejected file";
      this.incoming.delete(transferId);
      await this.sendSigned({
        kind: "file.receipt",
        transferId,
        ok: false,
        detail
      });
      this.handlers.onFileStatus?.({
        transferId,
        status: "failed",
        detail
      });
    }
  }
}
