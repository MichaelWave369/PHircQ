export type ParsedInput =
  | { kind: "message"; text: string }
  | { kind: "join"; room: string }
  | { kind: "me"; text: string }
  | { kind: "nick"; name: string }
  | { kind: "who" }
  | { kind: "topic"; text: string }
  | { kind: "help" }
  | { kind: "unknown"; command: string };

function roomName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function parseInput(raw: string): ParsedInput {
  const value = raw.trim();
  if (!value.startsWith("/")) return { kind: "message", text: raw };
  const [head, ...rest] = value.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch ((head || "").toLowerCase()) {
    case "join": return { kind: "join", room: roomName(arg) };
    case "me": return { kind: "me", text: arg };
    case "nick": return { kind: "nick", name: arg };
    case "who": return { kind: "who" };
    case "topic": return { kind: "topic", text: arg };
    case "help": return { kind: "help" };
    default: return { kind: "unknown", command: head || "" };
  }
}
