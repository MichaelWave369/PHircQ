import { describe, expect, it } from "vitest";
import { isTauriRuntime } from "./nativeBridge";

describe("native bridge", () => {
  it("does not pretend a Node/web test environment is Tauri", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});
