import { useEffect, useState } from "react";
import { getPersistentPeerIdentity } from "../phircq/identityStore";
import {
  isTauriRuntime,
  lanSnapshot,
  nativeInfo,
  probeLanPeer,
  startLanDiscovery,
  stopLanDiscovery,
  type LanPeer,
  type LanProbeResult,
  type NativeInfo
} from "../phircq/nativeBridge";

export interface LanDiscoveryPanelProps {
  localDisplayName: string;
  onNotice: (message: string) => void;
  onLinkPeer?: (peer: LanPeer) => void;
}

export function LanDiscoveryPanel({
  localDisplayName,
  onNotice,
  onLinkPeer
}: LanDiscoveryPanelProps) {
  const native = isTauriRuntime();
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Record<string, LanProbeResult>>({});

  useEffect(() => {
    if (!native) return;

    let cancelled = false;

    void nativeInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch((error) => {
        if (!cancelled) {
          onNotice(
            error instanceof Error
              ? error.message
              : "Unable to read native PHircQ state."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [native, onNotice]);

  useEffect(() => {
    if (!native || !info?.running) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await lanSnapshot();
        if (!cancelled) setPeers(next);
      } catch (error) {
        if (!cancelled) {
          onNotice(
            error instanceof Error
              ? error.message
              : "LAN discovery snapshot failed."
          );
        }
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [native, info?.running, onNotice]);

  async function start() {
    setBusy(true);

    try {
      const identity = await getPersistentPeerIdentity();
      const next = await startLanDiscovery(
        localDisplayName,
        identity.peerId
      );
      setInfo(next);
      setPeers(await lanSnapshot());
      onNotice(
        "Native mDNS discovery started with the persistent PHircQ peer id. Discovered devices remain untrusted until fingerprint approval."
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to start native LAN discovery."
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);

    try {
      const next = await stopLanDiscovery();
      setInfo(next);
      setPeers([]);
      setProbes({});
      onNotice("Native LAN discovery stopped.");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to stop native LAN discovery."
      );
    } finally {
      setBusy(false);
    }
  }

  async function probe(peer: LanPeer) {
    setBusy(true);

    try {
      const result = await probeLanPeer(peer.peerId);
      setProbes((current) => ({
        ...current,
        [peer.peerId]: result
      }));
      onNotice(
        result.reachable
          ? `Reached ${peer.displayName} at ${result.address}:${result.port}.`
          : `Could not reach ${peer.displayName}: ${result.detail}`
      );
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "LAN probe failed."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!native) {
    return (
      <section className="lan-panel">
        <div className="pane-title">NATIVE LAN</div>
        <p className="muted">
          mDNS discovery is available only in the Tauri desktop build. The web
          build does not fake LAN peers.
        </p>
      </section>
    );
  }

  return (
    <section className="lan-panel">
      <div className="pane-title">NATIVE LAN</div>

      <div className="network-fact">
        <span>shell</span>
        <strong>TAURI</strong>
      </div>
      <div className="network-fact">
        <span>mDNS</span>
        <strong>{info?.running ? "RUNNING" : "STOPPED"}</strong>
      </div>
      <div className="network-fact">
        <span>service</span>
        <strong>{info?.serviceType ?? "_phircq._tcp.local."}</strong>
      </div>
      <div className="network-fact">
        <span>signal handoff</span>
        <strong>{info?.running ? "READY" : "OFF"}</strong>
      </div>
      <div className="network-fact">
        <span>probe port</span>
        <strong>{info?.probePort ?? "OFF"}</strong>
      </div>

      <div className="paper-actions">
        <button disabled={busy || info?.running} onClick={() => void start()}>
          Start LAN discovery
        </button>
        <button disabled={busy || !info?.running} onClick={() => void stop()}>
          Stop LAN discovery
        </button>
      </div>

      <p className="muted">
        Discovery finds nearby nodes and can carry Paper Link offer/answer
        signals over the verified local probe endpoint. It still does not grant
        trust. Fingerprint approval remains explicit.
      </p>

      {peers.length === 0 ? (
        <p className="muted">No other PHircQ desktop nodes resolved yet.</p>
      ) : (
        peers.map((peer) => {
          const result = probes[peer.peerId];

          return (
            <div className="lan-peer" key={peer.peerId}>
              <strong>{peer.displayName}</strong>
              <code>{peer.peerId}</code>
              <span>{peer.hostname}</span>
              <span>
                {peer.addresses.length
                  ? peer.addresses.join(", ")
                  : "address pending"}
                :{peer.port}
              </span>
              <small>PHircQ {peer.version || "unknown"}</small>

              <div className="paper-actions">
                <button disabled={busy} onClick={() => void probe(peer)}>
                  Probe
                </button>
                <button
                  disabled={busy || !info?.running || !onLinkPeer}
                  onClick={() => onLinkPeer?.(peer)}
                >
                  Secure LAN link
                </button>
              </div>

              {result && (
                <small className={result.reachable ? "probe-ok" : "probe-fail"}>
                  {result.reachable ? "REACHABLE" : "UNREACHABLE"} ·{" "}
                  {result.detail}
                </small>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
