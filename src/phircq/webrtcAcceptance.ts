import { WebRtcTransport } from "./transport";

export interface WebRtcAcceptanceResult {
  ok: boolean;
  steps: string[];
}

function waitForDataChannel(peer: RTCPeerConnection): Promise<RTCDataChannel> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for remote data channel.")),
      10000
    );

    peer.addEventListener(
      "datachannel",
      (event) => {
        clearTimeout(timeout);
        resolve(event.channel);
      },
      { once: true }
    );
  });
}

function waitForIceComplete(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const handler = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", handler);
  });
}

export async function runBrowserWebRtcAcceptance(): Promise<WebRtcAcceptanceResult> {
  if (typeof RTCPeerConnection === "undefined") {
    return { ok: false, steps: ["RTCPeerConnection unavailable in this browser."] };
  }

  const steps: string[] = [];
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });

  try {
    const channelA = a.createDataChannel("phircq", {
      ordered: true
    });
    const channelBPromise = waitForDataChannel(b);

    a.addEventListener("icecandidate", (event) => {
      if (event.candidate) void b.addIceCandidate(event.candidate);
    });
    b.addEventListener("icecandidate", (event) => {
      if (event.candidate) void a.addIceCandidate(event.candidate);
    });

    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    steps.push("offer applied");

    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    steps.push("answer applied");

    await Promise.all([waitForIceComplete(a), waitForIceComplete(b)]);
    steps.push("ICE gathering complete with no external STUN/TURN");

    const channelB = await channelBPromise;
    const transportA = new WebRtcTransport("acceptance-a", channelA);
    const transportB = new WebRtcTransport("acceptance-b", channelB);

    await Promise.all([transportA.connect(), transportB.connect()]);
    steps.push("both data channels open");

    const received = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for WebRTC acceptance message.")),
        5000
      );
      const unsubscribe = transportB.subscribe((event) => {
        if (event.type !== "acceptance.ping") return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(String(event.payload));
      });
    });

    await transportA.send({
      type: "acceptance.ping",
      payload: "PHircQ"
    });

    const text = await received;
    if (text !== "PHircQ") throw new Error("WebRTC payload mismatch.");
    steps.push("real browser WebRTC payload round-trip passed");

    await Promise.all([transportA.disconnect(), transportB.disconnect()]);
    return { ok: true, steps };
  } catch (error) {
    steps.push(error instanceof Error ? error.message : "Unknown WebRTC acceptance failure.");
    return { ok: false, steps };
  } finally {
    a.close();
    b.close();
  }
}
