import { describe, expect, it } from "vitest";
import { parseInput } from "./commands";

describe("parseInput", () => {
  it("parses normal chat", () =>
    expect(parseInput("hello")).toEqual({ kind: "message", text: "hello" }));

  it("normalizes joins", () =>
    expect(parseInput("/join music")).toEqual({ kind: "join", room: "#music" }));

  it("parses actions", () =>
    expect(parseInput("/me waves")).toEqual({ kind: "me", text: "waves" }));

  it("keeps unknown commands inspectable", () =>
    expect(parseInput("/nope")).toEqual({ kind: "unknown", command: "nope" }));
});
