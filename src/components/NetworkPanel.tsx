import { useRef, useState } from "react";
import {
  PaperLinkEndpoint,
  encodePaperSignal,
  type PaperPeerDescriptor
} from "../phircq/paperLink";
import type { PeerSession } from "../phircq/peerSession";
import type { ClientRuntime } from "../phircq/runtime";
import type { RuntimeSnapshot } from "../phircq/types";
import { runBrowserWebRtcAcceptance } from "../phircq/webrtcAcceptance";

type LinkState =
  | "IDLE"
  | "WAITING_ANSWER"
  | "READY_TO_TRUST"
  | "CONNECTED"
  | "DISCONNECTED"
  | "ERROR";

export interface NetworkPanelProps {
  runtime: ClientRuntime;
  snapshot: RuntimeSnapshot;
  currentRoomName: string;
  localDisplayName: string;
  onRuntimeChange: () => void;
  onNotice: (message: string) => void;
}

export function NetworkPanel({
  runtime,
  snapshot,
  currentRoomName,
  localDisplayName,
  onRuntimeChange,
  onNotice
}: NetworkPanelProps) {
  const peerIdRef = useRef(`web-${crypto.randomUUID()}`);
  const endpointRef = useRef<PaperLinkEndpoint | null>(null);
  const sessionRef = useRef<PeerSession | null>(null);

  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkSteps, setNetworkSteps] = useState<string[]>([]);
  const [linkState, setLinkState] = useState<LinkState>("IDLE");
  const [localSignal, setLocalSignal] = useState("");
  const [remoteSignal, setRemoteSignal] = useState("");
  const [remotePeer, setRemotePeer] =
    useState<PaperPeerDescriptor | null>(null);
  const [remoteMessage, setRemoteMessage] = useState("");

  const remoteTrusted = remotePeer
    ? snapshot.peers.some(
        (peer) =>
          peer.peerId === remotePeer.peerId &&
          peer.fingerprint === remotePeer.fingerprint
      )
    : false;

  async function copySignal() {
    if (!localSignal) return;

    try {
      await navigator.clipboard.writeText(localSignal);
      onNotice("Paper Link signal copied.");
    } catch {
      onNotice(
        "Clipboard access failed. Select and copy the signal manually."
      );
    }
  }

  async function runSelfTest() {
    setNetworkBusy(true);
    setNetworkSteps([
      "starting strict-local browser WebRTC acceptance…"
    ]);

    try {
      const result = await runBrowserWebRtcAcceptance();
      setNetworkSteps(result.steps);
      onNotice(
        result.ok
          ? "WebRTC strict-local self-test passed."
          : "WebRTC strict-local self-test failed."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function newOffer() {
    await reset(false);
    setNetworkBusy(true);

    try {
      const endpoint = await PaperLinkEndpoint.createOffer({
        peerId: peerIdRef.current,
        displayName: localDisplayName
      });

      endpointRef.current = endpoint;
      setLocalSignal(encodePaperSignal(endpoint.localSignal));
      setLinkState("WAITING_ANSWER");
      onNotice(
        "Paper Link offer ready. Copy it to the other PHircQ client."
      );
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to create Paper Link offer."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function answerOffer() {
    await reset(false);

    if (!remoteSignal.trim()) {
      onNotice("Paste the other PHircQ client's offer first.");
      return;
    }

    setNetworkBusy(true);

    try {
      const endpoint = await PaperLinkEndpoint.acceptOffer(remoteSignal, {
        peerId: peerIdRef.current,
        displayName: localDisplayName
      });

      endpointRef.current = endpoint;
      setRemotePeer(endpoint.remotePeer ?? null);
      setLocalSignal(encodePaperSignal(endpoint.localSignal));
      setLinkState("READY_TO_TRUST");
      onNotice(
        "Paper Link answer ready. Copy it back, then verify the fingerprint."
      );
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to answer Paper Link offer."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function applyAnswer() {
    const endpoint = endpointRef.current;

    if (!endpoint) {
      onNotice("Create a Paper Link offer first.");
      return;
    }

    if (!remoteSignal.trim()) {
      onNotice("Paste the Paper Link answer first.");
      return;
    }

    setNetworkBusy(true);

    try {
      const remote = await endpoint.applyAnswer(remoteSignal);
      setRemotePeer(remote);
      setLinkState("READY_TO_TRUST");
      onNotice(
        "Answer applied. Verify the remote fingerprint before trusting."
      );
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to apply Paper Link answer."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  function trustRemote() {
    if (!remotePeer) return;

    runtime.trustPeer({
      peerId: remotePeer.peerId,
      displayName: remotePeer.displayName,
      fingerprint: remotePeer.fingerprint
    });

    onRuntimeChange();
    onNotice(
      `Trusted ${remotePeer.displayName} at fingerprint ${remotePeer.fingerprint.slice(0, 16)}…`
    );
  }

  async function connect() {
    const endpoint = endpointRef.current;

    if (!endpoint || !remotePeer) {
      onNotice("Complete the Paper Link offer/answer exchange first.");
      return;
    }

    if (!remoteTrusted) {
      onNotice(
        "Verify and trust the remote fingerprint before connecting chat."
      );
      return;
    }

    setNetworkBusy(true);

    try {
      const session = await endpoint.connectSession({
        trusts: () => runtime.state.peers,
        handlers: {
          onChat(message) {
            runtime.receivePeerChat(message);
            onRuntimeChange();
          },
          onUntrustedPeer(request) {
            onNotice(
              `Signed frame from untrusted peer ${request.displayName} (${request.fingerprint.slice(0, 16)}…).`
            );
          },
          onRejected(reason) {
            onNotice(`Remote frame rejected: ${reason}`);
          }
        }
      });

      sessionRef.current = session;
      setLinkState("CONNECTED");
      onNotice(`Paper Link connected to ${remotePeer.displayName}.`);
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to connect Paper Link."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function sendRemote() {
    const session = sessionRef.current;

    if (!session || linkState !== "CONNECTED") {
      onNotice("Paper Link is not connected.");
      return;
    }

    if (!remoteMessage.trim()) return;

    try {
      await session.sendChat({
        roomName: currentRoomName,
        displayName: localDisplayName,
        text: remoteMessage
      });

      runtime.submit(remoteMessage);
      setRemoteMessage("");
      onRuntimeChange();
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to send peer message."
      );
    }
  }

  async function disconnect() {
    const endpoint = endpointRef.current;

    try {
      if (endpoint) await endpoint.close();
    } finally {
      sessionRef.current = null;
      endpointRef.current = null;
      setLinkState("DISCONNECTED");
      onNotice(
        "Paper Link disconnected. Start a new offer to re-link."
      );
    }
  }

  async function reset(clearRemote = true) {
    const endpoint = endpointRef.current;

    if (endpoint) {
      try {
        await endpoint.close();
      } catch {
        // Reset local UI even if the browser races channel teardown.
      }
    }

    endpointRef.current = null;
    sessionRef.current = null;
    setLocalSignal("");
    if (clearRemote) setRemoteSignal("");
    setRemotePeer(null);
    setLinkState("IDLE");
  }

  return (
    <div className="network-panel">
      <div className="pane-title">NETWORK CONTRACT</div>

      <div className="network-fact">
        <span>mode</span>
        <strong>STRICT LOCAL</strong>
      </div>
      <div className="network-fact">
        <span>link</span>
        <strong>{linkState}</strong>
      </div>
      <div className="network-fact">
        <span>trusted peers</span>
        <strong>{snapshot.peers.length}</strong>
      </div>
      <div className="network-fact">
        <span>frame signing</span>
        <strong>ECDSA P-256</strong>
      </div>
      <div className="network-fact">
        <span>external STUN/TURN</span>
        <strong>OFF</strong>
      </div>

      <button
        disabled={networkBusy}
        onClick={() => void runSelfTest()}
      >
        {networkBusy ? "Working…" : "Run real WebRTC self-test"}
      </button>

      <div className="network-log">
        {networkSteps.length === 0 ? (
          <p className="muted">
            The self-test creates two actual RTCPeerConnections with no
            external ICE servers and moves a PHircQ payload over
            RTCDataChannel.
          </p>
        ) : (
          networkSteps.map((step, index) => (
            <div key={`${index}-${step}`}>
              [{index + 1}] {step}
            </div>
          ))
        )}
      </div>

      <div className="pane-title">PAPER LINK</div>
      <p className="muted">
        No signaling server. One client makes an offer, the other pastes it
        and returns an answer. Compare fingerprints before trusting.
      </p>

      <div className="paper-actions">
        <button
          disabled={networkBusy}
          onClick={() => void newOffer()}
        >
          Make offer
        </button>
        <button
          disabled={networkBusy}
          onClick={() => void answerOffer()}
        >
          Answer pasted offer
        </button>
      </div>

      <label>
        signal to send
        <textarea
          rows={7}
          readOnly
          value={localSignal}
          placeholder="Your offer or answer appears here."
        />
      </label>

      <button
        disabled={!localSignal}
        onClick={() => void copySignal()}
      >
        Copy my signal
      </button>

      <label>
        signal received
        <textarea
          rows={7}
          value={remoteSignal}
          onChange={(event) => setRemoteSignal(event.target.value)}
          placeholder="Paste the other PHircQ client's offer or answer here."
        />
      </label>

      <button
        disabled={
          !endpointRef.current ||
          endpointRef.current.role !== "offerer" ||
          networkBusy
        }
        onClick={() => void applyAnswer()}
      >
        Apply pasted answer
      </button>

      {remotePeer && (
        <div className="fingerprint-card">
          <strong>{remotePeer.displayName}</strong>
          <span>{remotePeer.peerId}</span>
          <code>{remotePeer.fingerprint}</code>
          <small>
            Compare this fingerprint on both machines before trusting.
          </small>
          <button disabled={remoteTrusted} onClick={trustRemote}>
            {remoteTrusted ? "Trusted" : "Trust this fingerprint"}
          </button>
        </div>
      )}

      <div className="paper-actions">
        <button
          disabled={
            !remotePeer ||
            !remoteTrusted ||
            networkBusy ||
            linkState === "CONNECTED"
          }
          onClick={() => void connect()}
        >
          Connect chat
        </button>

        <button
          disabled={!endpointRef.current}
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>

        <button onClick={() => void reset()}>
          Reset / re-link
        </button>
      </div>

      <label>
        peer message to {currentRoomName}
        <textarea
          rows={3}
          value={remoteMessage}
          onChange={(event) => setRemoteMessage(event.target.value)}
          placeholder="Send through the connected signed Paper Link."
        />
      </label>

      <button
        disabled={
          linkState !== "CONNECTED" || !remoteMessage.trim()
        }
        onClick={() => void sendRemote()}
      >
        Send to linked peer
      </button>

      <div className="pane-title">TRUSTED PEERS</div>

      {snapshot.peers.length === 0 ? (
        <p className="muted">No trusted remote peers yet.</p>
      ) : (
        snapshot.peers.map((peer) => (
          <div className="peer-row" key={peer.peerId}>
            <strong>{peer.displayName}</strong>
            <code>{peer.fingerprint.slice(0, 24)}…</code>
          </div>
        ))
      )}
    </div>
  );
}
