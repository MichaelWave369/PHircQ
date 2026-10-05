import { describe, expect, it } from "vitest";
import { MemoryBlobStore, sha256Hex } from "./attachments";

describe("attachments", () => {
  it("hashes bytes deterministically", async () => {
    const blob = new Blob(["PHircQ"]);
    const first = await sha256Hex(blob);
    const second = await sha256Hex(blob);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces the total blob budget", async () => {
    const store = new MemoryBlobStore(8, 10);

    await store.put("a", new Blob(["123456"]));
    await expect(
      store.put("b", new Blob(["12345"]))
    ).rejects.toThrow("Attachment store is full.");
  });

  it("can round-trip local bytes", async () => {
    const store = new MemoryBlobStore();
    await store.put("note", new Blob(["hello"]));

    const restored = await store.get("note");
    expect(await restored?.text()).toBe("hello");
  });
});
