import {
  createPeerIdentity,
  exportPeerIdentity,
  importPeerIdentity,
  type PeerIdentity,
  type StoredPeerIdentity
} from "./peerCrypto";

interface IdentityRow {
  slot: string;
  identity: StoredPeerIdentity;
}

const DB_NAME = "phircq-identity-v1";
const STORE_NAME = "identity";
const DEFAULT_SLOT = "default";

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "slot" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open PHircQ identity vault."));
  });
}

async function readStored(slot: string): Promise<StoredPeerIdentity | null> {
  const db = await openIdentityDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(slot);

    request.onsuccess = () => {
      const row = request.result as IdentityRow | undefined;
      resolve(row?.identity ?? null);
    };

    request.onerror = () =>
      reject(request.error ?? new Error("Unable to read PHircQ identity."));
  });
}

async function writeStored(
  slot: string,
  identity: StoredPeerIdentity
): Promise<void> {
  const db = await openIdentityDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ slot, identity } satisfies IdentityRow);

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Unable to persist PHircQ identity."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("PHircQ identity persistence aborted."));
  });
}

export async function getPersistentPeerIdentity(
  slot = DEFAULT_SLOT
): Promise<PeerIdentity> {
  if (typeof indexedDB === "undefined") {
    return createPeerIdentity("peer-" + crypto.randomUUID());
  }

  const existing = await readStored(slot);

  if (existing) {
    try {
      return await importPeerIdentity(existing);
    } catch {
      // Replace only an unreadable identity record, not the whole client.
    }
  }

  const created = await createPeerIdentity("peer-" + crypto.randomUUID());
  await writeStored(slot, await exportPeerIdentity(created));
  return created;
}
