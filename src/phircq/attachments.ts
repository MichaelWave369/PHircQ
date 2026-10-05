import type { AttachmentMeta } from "./types";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_BLOB_STORE_BYTES = 100 * 1024 * 1024;

export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  delete(id: string): Promise<void>;
  usageBytes(): Promise<number>;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createAttachmentMeta(file: File, actorId: string): Promise<AttachmentMeta> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit.`);
  }

  return {
    id: `attachment_${crypto.randomUUID()}`,
    actorId,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    sha256: await sha256Hex(file),
    createdAt: new Date().toISOString()
  };
}

export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Blob>();

  constructor(
    private readonly maxFileBytes = MAX_ATTACHMENT_BYTES,
    private readonly maxTotalBytes = MAX_BLOB_STORE_BYTES
  ) {}

  async put(id: string, blob: Blob): Promise<void> {
    if (blob.size > this.maxFileBytes) throw new Error("Attachment exceeds per-file limit.");

    const previous = this.blobs.get(id)?.size ?? 0;
    const usage = await this.usageBytes();
    if (usage - previous + blob.size > this.maxTotalBytes) {
      throw new Error("Attachment store is full.");
    }

    this.blobs.set(id, blob);
  }

  async get(id: string): Promise<Blob | null> {
    return this.blobs.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.blobs.delete(id);
  }

  async usageBytes(): Promise<number> {
    let total = 0;
    for (const blob of this.blobs.values()) total += blob.size;
    return total;
  }
}

export class BrowserBlobStore implements BlobStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName = "phircq-blobs-v1",
    private readonly maxFileBytes = MAX_ATTACHMENT_BYTES,
    private readonly maxTotalBytes = MAX_BLOB_STORE_BYTES
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs", { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open blob store."));
    });

    return this.dbPromise;
  }

  async put(id: string, blob: Blob): Promise<void> {
    if (blob.size > this.maxFileBytes) throw new Error("Attachment exceeds per-file limit.");

    const existing = await this.get(id);
    const usage = await this.usageBytes();
    if (usage - (existing?.size ?? 0) + blob.size > this.maxTotalBytes) {
      throw new Error("Attachment store is full.");
    }

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put({ id, blob, size: blob.size });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Unable to save attachment."));
      tx.onabort = () => reject(tx.error ?? new Error("Attachment save aborted."));
    });
  }

  async get(id: string): Promise<Blob | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const request = tx.objectStore("blobs").get(id);
      request.onsuccess = () => {
        const row = request.result as { blob?: Blob } | undefined;
        resolve(row?.blob ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read attachment."));
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Unable to delete attachment."));
    });
  }

  async usageBytes(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const request = tx.objectStore("blobs").getAll();
      request.onsuccess = () => {
        const rows = request.result as Array<{ size?: number }>;
        resolve(rows.reduce((total, row) => total + (row.size ?? 0), 0));
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to measure attachment store."));
    });
  }
}
