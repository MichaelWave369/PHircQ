import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "./transport";

describe("transport contract", () => {
  it("delivers events between two connected transports", async () => {
    const [a, b] = createMemoryTransportPair();
    await Promise.all([a.connect(), b.connect()]);

    const received = new Promise<string>((resolve) => {
      b.subscribe((event) => resolve(String(event.payload)));
    });

    await a.send({ type: "test", payload: "PHircQ" });

    await expect(received).resolves.toBe("PHircQ");
  });

  it("refuses sends while disconnected", async () => {
    const [a] = createMemoryTransportPair();

    await expect(
      a.send({ type: "test", payload: "nope" })
    ).rejects.toThrow("Transport is not connected.");
  });
});
