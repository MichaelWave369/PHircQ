export interface NativeInfo {
  native: boolean;
  instanceId: string;
  serviceType: string;
  running: boolean;
  probePort: number | null;
}

export interface LanPeer {
  peerId: string;
  displayName: string;
  fullname: string;
  hostname: string;
  addresses: string[];
  port: number;
  version: string;
}

export interface LanProbeResult {
  peerId: string;
  address: string | null;
  port: number;
  reachable: boolean;
  detail: string;
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Native PHircQ command is unavailable in the web build.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function nativeInfo(): Promise<NativeInfo> {
  return invokeNative<NativeInfo>("native_info");
}

export function startLanDiscovery(displayName: string): Promise<NativeInfo> {
  return invokeNative<NativeInfo>("lan_start", { displayName });
}

export function stopLanDiscovery(): Promise<NativeInfo> {
  return invokeNative<NativeInfo>("lan_stop");
}

export function lanSnapshot(): Promise<LanPeer[]> {
  return invokeNative<LanPeer[]>("lan_snapshot");
}

export function probeLanPeer(peerId: string): Promise<LanProbeResult> {
  return invokeNative<LanProbeResult>("lan_probe", { peerId });
}
