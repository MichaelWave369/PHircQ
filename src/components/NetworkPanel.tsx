import { useEffect, useRef, useState } from "react";
import { LanDiscoveryPanel } from "./LanDiscoveryPanel";
import { getPersistentPeerIdentity } from "../phircq/identityStore";
import {
  PaperLinkEndpoint,
  encodePaperSignal,
  type PaperPeerDescriptor
} from "../phircq/paperLink";
import type { IncomingFileOffer, PeerSession } from "../phircq/peerSession";
import {
  isTauriRuntime,
  sendLanSignal,
  takeLanSignals,
  type LanPeer,
  type LanSignalEnvelope
} from "../phircq/nativeBridge";
import type { PeerIdentity } from "../phircq/peerCrypto";
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
  const identityRef = useRef<PeerIdentity | null>(null);
  const lanPollBusyRef = useRef(false);
  const endpointRef = useRef<PaperLinkEndpoint | null>(null);
  const sessionRef = useRef<PeerSession | null>(null);
  const peerFileInputRef = useRef<HTMLInputElement | null>(null);

  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkSteps, setNetworkSteps] = useState<string[]>([]);
  const [linkState, setLinkState] = useState<LinkState>("IDLE");
  const [localSignal, setLocalSignal] = useState("");
  const [remoteSignal, setRemoteSignal] = useState("");
  const [remotePeer, setRemotePeer] =
    useState<PaperPeerDescriptor | null>(null);
  const [remoteMessage, setRemoteMessage] = useState("");
  const [incomingFileOffer, setIncomingFileOffer] =
    useState<IncomingFileOffer | null>(null);
  const [fileTransferStatus, setFileTransferStatus] = useState("");
  const [fileTransferProgress, setFileTransferProgress] = useState(0);
  const [localFingerprint, setLocalFingerprint] = useState("");
  const [localPeerId, setLocalPeerId] = useState("");
  const [lanTarget, setLanTarget] = useState<LanPeer | null>(null);

  async function persistentIdentity(): Promise<PeerIdentity> {
    if (identityRef.current) return identityRef.current;

    const identity = await getPersistentPeerIdentity();
    identityRef.current = identity;
    setLocalFingerprint(identity.fingerprint);
    setLocalPeerId(identity.peerId);
    return identity;
  }

  useEffect(() => {
    let cancelled = false;

    void getPersistentPeerIdentity()
      .then((identity) => {
        if (cancelled) return;
        identityRef.current = identity;
        setLocalFingerprint(identity.fingerprint);
        setLocalPeerId(identity.peerId);
      })
      .catch((error) => {
        if (!cancelled) {
          onNotice(
            error instanceof Error
              ? error.message
              : "Unable to load persistent PHircQ identity."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onNotice]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || lanPollBusyRef.current) return;
      lanPollBusyRef.current = true;

      try {
        const signals = await takeLanSignals();
        for (const signal of signals) {
          if (cancelled) break;
          await handleLanSignal(signal);
        }
      } catch (error) {
        if (!cancelled) {
          onNotice(
            error instanceof Error
              ? error.message
              : "Unable to read native LAN link signals."
          );
        }
      } finally {
        lanPollBusyRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [localDisplayName, onNotice, linkState]);

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

  async function beginLanLink(peer: LanPeer) {
    await reset(false);
    setNetworkBusy(true);
    setLanTarget(peer);

    try {
      const identity = await persistentIdentity();

      const endpoint = await PaperLinkEndpoint.createOffer({
        identity,
        displayName: localDisplayName
      });

      const encoded = encodePaperSignal(endpoint.localSignal);
      endpointRef.current = endpoint;
      setLocalSignal(encoded);

      const delivery = await sendLanSignal(
        peer.peerId,
        "offer",
        encoded
      );

      if (!delivery.delivered) {
        await endpoint.close();
        endpointRef.current = null;
        setLinkState("ERROR");
        throw new Error(delivery.detail);
      }

      setLinkState("WAITING_ANSWER");
      onNotice(
        `Secure LAN offer delivered to ${peer.displayName}. Waiting for its answer; trust is still not granted.`
      );
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to begin secure LAN link."
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function handleLanSignal(envelope: LanSignalEnvelope) {
    if (envelope.schema !== "phircq.lan-link.v1") return;

    if (envelope.kind === "offer") {
      if (linkState === "CONNECTED") {
        onNotice(
          "Ignored a LAN link offer because this PHircQ client is already connected."
        );
        return;
      }

      await reset(false);

      try {
        const identity = await persistentIdentity();
        const endpoint = await PaperLinkEndpoint.acceptOffer(
          envelope.signal,
          {
            identity,
            displayName: localDisplayName
          }
        );

        const remote = endpoint.remotePeer;
        if (!remote || remote.peerId !== envelope.fromPeerId) {
          await endpoint.close();
          throw new Error(
            "LAN offer identity did not match the verified discovery peer."
          );
        }

        endpointRef.current = endpoint;
        setRemotePeer(remote);
        const encodedAnswer = encodePaperSignal(endpoint.localSignal);
        setLocalSignal(encodedAnswer);

        const delivery = await sendLanSignal(
          envelope.fromPeerId,
          "answer",
          encodedAnswer
        );

        if (!delivery.delivered) {
          throw new Error(delivery.detail);
        }

        setLinkState("READY_TO_TRUST");
        onNotice(
          `LAN invite from ${remote.displayName} negotiated. Compare fingerprint ${remote.fingerprint.slice(0, 16)}… before trusting.`
        );
      } catch (error) {
        setLinkState("ERROR");
        onNotice(
          error instanceof Error
            ? error.message
            : "Unable to answer LAN link offer."
        );
      }

      return;
    }

    const endpoint = endpointRef.current;
    if (!endpoint || endpoint.role !== "offerer") {
      onNotice("Ignored an unexpected LAN link answer.");
      return;
    }

    try {
      const remote = await endpoint.applyAnswer(envelope.signal);

      if (remote.peerId !== envelope.fromPeerId) {
        throw new Error(
          "LAN answer identity did not match the verified discovery peer."
        );
      }

      setRemotePeer(remote);
      setLinkState("READY_TO_TRUST");
      onNotice(
        `LAN answer received from ${remote.displayName}. Compare fingerprint ${remote.fingerprint.slice(0, 16)}… before trusting.`
      );
    } catch (error) {
      setLinkState("ERROR");
      onNotice(
        error instanceof Error
          ? error.message
          : "Unable to apply LAN link answer."
      );
    }
  }

  async function newOffer() {
    await reset(false);
    setNetworkBusy(true);

    try {
      const identity = await persistentIdentity();
      const endpoint = await PaperLinkEndpoint.createOffer({
        identity,
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
      const identity = await persistentIdentity();
      const endpoint = await PaperLinkEndpoint.acceptOffer(remoteSignal, {
        identity,
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

  function forgetPeer(peerId: string) {
    runtime.removePeer(peerId);
    if (remotePeer?.peerId === peerId) {
      onNotice("Peer trust removed. Existing signed frames will no longer be admitted.");
    }
    onRuntimeChange();
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
          onFileOffer(offer) {
            setIncomingFileOffer(offer);
            setFileTransferStatus(
              `Incoming ${offer.offer.name} · ${offer.offer.size.toLocaleString()} bytes`
            );
            setFileTransferProgress(0);
            onNotice(
              `${offer.offer.displayName} offered ${offer.offer.name}. Accept or reject it explicitly.`
            );
          },
          onFileProgress(progress) {
            const percent =
              progress.totalBytes === 0
                ? 100
                : Math.min(
                    100,
                    Math.round(
                      (progress.completedBytes / progress.totalBytes) * 100
                    )
                  );
            setFileTransferProgress(percent);
            setFileTransferStatus(
              `${progress.direction === "send" ? "Sending" : "Receiving"} · ${percent}%`
            );
          },
          async onFileReceived(file) {
            await runtime.receivePeerFile(file);
            setIncomingFileOffer(null);
            setFileTransferProgress(100);
            setFileTransferStatus(
              `Received ${file.name} · SHA-256 verified`
            );
            onRuntimeChange();
            onNotice(
              `Received ${file.name} from ${file.displayName}; SHA-256 verified before admission.`
            );
          },
          onFileStatus(status) {
            if (status.status === "sent") {
              setFileTransferProgress(100);
            }
            setFileTransferStatus(
              `${status.status.toUpperCase()}${status.detail ? ` · ${status.detail}` : ""}`
            );
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

  async function sendPeerFile(file: File | undefined) {
    if (!file) return;

    const session = sessionRef.current;
    if (!session || linkState !== "CONNECTED") {
      onNotice("Connect a trusted Paper Link before sending a file.");
      if (peerFileInputRef.current) peerFileInputRef.current.value = "";
      return;
    }

    setFileTransferProgress(0);
    setFileTransferStatus(`Hashing ${file.name}…`);

    try {
      const offer = await session.offerFile({
        file,
        name: file.name,
        mimeType: file.type,
        roomName: currentRoomName,
        displayName: localDisplayName
      });
      setFileTransferStatus(
        `OFFERED · ${offer.name} · waiting for remote acceptance`
      );
      onNotice(
        `File offer sent for ${offer.name}. Bytes will not move until the remote operator accepts.`
      );
    } catch (error) {
      setFileTransferStatus("FAILED");
      onNotice(
        error instanceof Error ? error.message : "Unable to offer peer file."
      );
    } finally {
      if (peerFileInputRef.current) peerFileInputRef.current.value = "";
    }
  }

  async function acceptIncomingFile() {
    const session = sessionRef.current;
    if (!session || !incomingFileOffer) return;

    try {
      await session.acceptFile(incomingFileOffer.offer.transferId);
      setFileTransferStatus(
        `ACCEPTED · receiving ${incomingFileOffer.offer.name}`
      );
      onNotice(
        `Accepted ${incomingFileOffer.offer.name}. PHircQ will verify size and SHA-256 before storing it.`
      );
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Unable to accept peer file."
      );
    }
  }

  async function rejectIncomingFile() {
    const session = sessionRef.current;
    if (!session || !incomingFileOffer) return;

    try {
      await session.rejectFile(incomingFileOffer.offer.transferId);
      setFileTransferStatus(
        `REJECTED · ${incomingFileOffer.offer.name}`
      );
      setIncomingFileOffer(null);
      setFileTransferProgress(0);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Unable to reject peer file."
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
    setLanTarget(null);
    setIncomingFileOffer(null);
    setFileTransferStatus("");
    setFileTransferProgress(0);
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
        <span>persistent peer</span>
        <strong>{localPeerId ? localPeerId.slice(0, 18) + "…" : "LOADING"}</strong>
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

      <LanDiscoveryPanel
        localDisplayName={localDisplayName}
        onNotice={onNotice}
        onLinkPeer={(peer) => void beginLanLink(peer)}
      />

      <div className="pane-title">PAPER LINK</div>

      {(localFingerprint || endpointRef.current) && (
        <div className="fingerprint-card local">
          <strong>THIS CLIENT</strong>
          <span>{localDisplayName}</span>
          <code>
            {localFingerprint || endpointRef.current?.identity.fingerprint}
          </code>
          <small>
            Persistent local identity. Read this fingerprint to the other
            operator before first trust.
          </small>
        </div>
      )}

      {lanTarget && linkState === "WAITING_ANSWER" && (
        <p className="muted">
          LAN handoff waiting on {lanTarget.displayName}. No cloud signaling
          service is involved.
        </p>
      )}

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

      <div className="pane-title">DIRECT PEER FILES</div>
      <p className="muted">
        File bytes move only after the receiving operator accepts the signed
        offer. Transfers are chunked, backpressure-aware and SHA-256 verified
        before local storage admission.
      </p>

      <input
        ref={peerFileInputRef}
        type="file"
        disabled={linkState !== "CONNECTED"}
        onChange={(event) =>
          void sendPeerFile(event.target.files?.[0])
        }
      />

      {fileTransferStatus && (
        <div className="file-transfer-status">
          <strong>{fileTransferStatus}</strong>
          <progress max={100} value={fileTransferProgress} />
          <span>{fileTransferProgress}%</span>
        </div>
      )}

      {incomingFileOffer && (
        <div className="incoming-file-offer">
          <strong>{incomingFileOffer.offer.name}</strong>
          <span>
            {incomingFileOffer.offer.size.toLocaleString()} bytes ·{" "}
            {incomingFileOffer.offer.mimeType}
          </span>
          <code>
            sha256:{incomingFileOffer.offer.sha256}
          </code>
          <div className="paper-actions">
            <button onClick={() => void acceptIncomingFile()}>
              Accept file
            </button>
            <button onClick={() => void rejectIncomingFile()}>
              Reject file
            </button>
          </div>
        </div>
      )}

      <div className="pane-title">TRUSTED PEERS</div>

      {snapshot.peers.length === 0 ? (
        <p className="muted">No trusted remote peers yet.</p>
      ) : (
        snapshot.peers.map((peer) => (
          <div className="peer-row" key={peer.peerId}>
            <strong>{peer.displayName}</strong>
            <code>{peer.fingerprint.slice(0, 24)}…</code>
            <button onClick={() => forgetPeer(peer.peerId)}>
              Forget trust
            </button>
          </div>
        ))
      )}
    </div>
  );
}
