export type TransportState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

export interface TransportEvent {
  type: string;
  payload: unknown;
}

export interface Transport {
  readonly id: string;
  readonly kind: "memory" | "webrtc";
  state(): TransportState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(event: TransportEvent): Promise<void>;
  subscribe(handler: (event: TransportEvent) => void): () => void;
}

export class MemoryTransport implements Transport {
  readonly kind = "memory" as const;
  private peer?: MemoryTransport;
  private currentState: TransportState = "DISCONNECTED";
  private readonly handlers = new Set<(event: TransportEvent) => void>();

  constructor(readonly id: string) {}

  pairWith(peer: MemoryTransport): void {
    this.peer = peer;
  }

  state(): TransportState {
    return this.currentState;
  }

  async connect(): Promise<void> {
    this.currentState = "CONNECTED";
  }

  async disconnect(): Promise<void> {
    this.currentState = "DISCONNECTED";
  }

  async send(event: TransportEvent): Promise<void> {
    if (this.currentState !== "CONNECTED") {
      throw new Error("Transport is not connected.");
    }
    if (!this.peer || this.peer.currentState !== "CONNECTED") {
      throw new Error("Peer transport is not connected.");
    }

    const copy = structuredClone(event);
    queueMicrotask(() => {
      for (const handler of this.peer!.handlers) handler(copy);
    });
  }

  subscribe(handler: (event: TransportEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export function createMemoryTransportPair(): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport("memory-a");
  const b = new MemoryTransport("memory-b");
  a.pairWith(b);
  b.pairWith(a);
  return [a, b];
}

export class WebRtcTransport implements Transport {
  readonly kind = "webrtc" as const;
  private currentState: TransportState = "DISCONNECTED";
  private readonly handlers = new Set<(event: TransportEvent) => void>();

  constructor(
    readonly id: string,
    private readonly channel: RTCDataChannel
  ) {
    this.channel.addEventListener("open", () => {
      this.currentState = "CONNECTED";
    });
    this.channel.addEventListener("close", () => {
      this.currentState = "DISCONNECTED";
    });
    this.channel.addEventListener("error", () => {
      this.currentState = "ERROR";
    });
    this.channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as TransportEvent;
        if (!parsed || typeof parsed.type !== "string") return;
        for (const handler of this.handlers) handler(parsed);
      } catch {
        // Invalid transport frames are ignored here and never reach governance.
      }
    });
  }

  state(): TransportState {
    if (this.channel.readyState === "open") return "CONNECTED";
    if (this.channel.readyState === "connecting") return "CONNECTING";
    if (this.channel.readyState === "closed") return "DISCONNECTED";
    return this.currentState;
  }

  async connect(): Promise<void> {
    if (this.channel.readyState === "open") {
      this.currentState = "CONNECTED";
      return;
    }
    if (this.channel.readyState === "closed") {
      throw new Error("WebRTC data channel is closed.");
    }

    this.currentState = "CONNECTING";
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for WebRTC data channel."));
      }, 10000);

      const onOpen = () => {
        cleanup();
        this.currentState = "CONNECTED";
        resolve();
      };
      const onError = () => {
        cleanup();
        this.currentState = "ERROR";
        reject(new Error("WebRTC data channel failed."));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.channel.removeEventListener("open", onOpen);
        this.channel.removeEventListener("error", onError);
      };

      this.channel.addEventListener("open", onOpen);
      this.channel.addEventListener("error", onError);
    });
  }

  async disconnect(): Promise<void> {
    if (this.channel.readyState !== "closed") this.channel.close();
    this.currentState = "DISCONNECTED";
  }

  async send(event: TransportEvent): Promise<void> {
    if (this.channel.readyState !== "open") {
      throw new Error("WebRTC data channel is not open.");
    }
    this.channel.send(JSON.stringify(event));
  }

  subscribe(handler: (event: TransportEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
