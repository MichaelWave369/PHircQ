export interface SignedFrame<T = unknown> {
  id: string;
  peerId: string;
  sentAt: string;
  payload: T;
  publicKey: JsonWebKey;
  signature: string;
}

export interface PeerIdentity {
  peerId: string;
  keyPair: CryptoKeyPair;
  publicKey: JsonWebKey;
  fingerprint: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalFrameBody(frame: Pick<SignedFrame, "id" | "peerId" | "sentAt" | "payload">): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      id: frame.id,
      peerId: frame.peerId,
      sentAt: frame.sentAt,
      payload: frame.payload
    })
  );
}

export async function fingerprintPublicKey(publicKey: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: publicKey.crv,
    kty: publicKey.kty,
    x: publicKey.x,
    y: publicKey.y
  });
  return sha256Hex(new TextEncoder().encode(canonical));
}

export async function createPeerIdentity(peerId: string): Promise<PeerIdentity> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    peerId,
    keyPair,
    publicKey,
    fingerprint: await fingerprintPublicKey(publicKey)
  };
}

export async function signFrame<T>(
  identity: PeerIdentity,
  payload: T
): Promise<SignedFrame<T>> {
  const frame = {
    id: crypto.randomUUID(),
    peerId: identity.peerId,
    sentAt: new Date().toISOString(),
    payload
  };

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.keyPair.privateKey,
    canonicalFrameBody(frame)
  );

  return {
    ...frame,
    publicKey: identity.publicKey,
    signature: bytesToBase64(new Uint8Array(signature))
  };
}

export async function verifyFrame<T>(frame: SignedFrame<T>): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      frame.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64ToBytes(frame.signature),
      canonicalFrameBody(frame)
    );
  } catch {
    return false;
  }
}

export class ReplayWindow {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly maxEntries = 2048) {}

  accept(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);

    while (this.order.length > this.maxEntries) {
      const evicted = this.order.shift();
      if (evicted) this.seen.delete(evicted);
    }

    return true;
  }
}
