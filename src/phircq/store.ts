import type { RuntimeSnapshot } from "./types";

export interface SnapshotStore {
  load(): RuntimeSnapshot | null;
  save(snapshot: RuntimeSnapshot): void;
}

export class MemoryStore implements SnapshotStore {
  private snapshot: RuntimeSnapshot | null = null;
  load(): RuntimeSnapshot | null { return this.snapshot ? structuredClone(this.snapshot) : null; }
  save(snapshot: RuntimeSnapshot): void { this.snapshot = structuredClone(snapshot); }
}

export class LocalStorageStore implements SnapshotStore {
  constructor(private readonly key = "phircq:v0.1") {}
  load(): RuntimeSnapshot | null {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    try { return JSON.parse(raw) as RuntimeSnapshot; } catch { return null; }
  }
  save(snapshot: RuntimeSnapshot): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.key, JSON.stringify(snapshot));
  }
}
