import { useEffect, useRef, useCallback, useState } from "react";
import "webrtc-adapter"; // cross-browser shim — patches RTCPeerConnection globally
import { socket } from "../socket";

// ── ICE Config ─────────────────────────────────────────────────────────────
// STUN: discovers your public IP (works on same network)
// TURN: relays media when direct P2P fails (required across different networks)
const ICE_CONFIG = {
  iceServers: [
    // Google STUN
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // Open Relay STUN + TURN (free, no signup)
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "turn:openrelay.metered.ca:80",  username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turns:openrelay.metered.ca:443",username: "openrelayproject", credential: "openrelayproject" },
    // FreeStan TURN (second free fallback)
    { urls: "stun:freestun.net:3479" },
    { urls: "turn:freestun.net:3479",  username: "free", credential: "free" },
    { urls: "turns:freestun.net:5350", username: "free", credential: "free" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// NOTE: VP9 codec preference removed — iOS Safari & many Android browsers
// don't support VP9 in WebRTC. Forcing it breaks the call on mobile.
// Let the browser negotiate the best supported codec automatically.

// ── Apply bandwidth constraints via SDP ────────────────────────────────────
function applyBandwidth(sdp, audioBW = 50, videoBW = 1500) {
  let result = sdp;
  // Video bandwidth
  result = result.replace(
    /a=mid:video\r?\n/,
    `a=mid:video\r\nb=AS:${videoBW}\r\n`
  );
  // Audio bandwidth
  result = result.replace(
    /a=mid:audio\r?\n/,
    `a=mid:audio\r\nb=AS:${audioBW}\r\n`
  );
  return result;
}

// ── Noise suppression via Web Audio API ────────────────────────────────────
async function applyNoiseSuppression(stream) {
  try {
    const audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    const dst = audioCtx.createMediaStreamDestination();

    // Built-in dynamics compressor — reduces background noise
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -40;
    compressor.knee.value = 10;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    // High-pass filter — cuts low rumble below 80Hz
    const highPass = audioCtx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 80;

    src.connect(highPass);
    highPass.connect(compressor);
    compressor.connect(dst);

    // Replace audio track with processed one
    const processedAudio = dst.stream.getAudioTracks()[0];
    const videoTracks = stream.getVideoTracks();
    return new MediaStream([processedAudio, ...videoTracks]);
  } catch (e) {
    console.warn("Noise suppression failed, using raw stream:", e);
    return stream;
  }
}

// ── Main hook ──────────────────────────────────────────────────────────────
export function useWebRTC({ roomId, userName, localVideoRef, remoteVideoRef, onStatusChange, onChat }) {
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const statsIntervalRef = useRef(null);
  const [networkQuality, setNetworkQuality] = useState(null); // { rtt, packetLoss, bitrate, quality }
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // ── Cleanup ──────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearInterval(statsIntervalRef.current);
    if (peerRef.current) { peerRef.current.close(); peerRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localVideoRef.current)  localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setIsScreenSharing(false);
    setNetworkQuality(null);
  }, [localVideoRef, remoteVideoRef]);

  // ── Network stats polling ────────────────────────────────
  const startStatsPolling = useCallback(() => {
    clearInterval(statsIntervalRef.current);
    let lastBytesSent = 0;
    let lastTs = Date.now();

    statsIntervalRef.current = setInterval(async () => {
      if (!peerRef.current) return;
      try {
        const stats = await peerRef.current.getStats();
        let rtt = null, packetLoss = null, bytesSent = 0;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
          }
          if (report.type === "outbound-rtp" && report.kind === "video") {
            bytesSent = report.bytesSent || 0;
            const sent = report.packetsSent || 0;
            const lost = report.packetsLost || 0;
            packetLoss = sent > 0 ? ((lost / (sent + lost)) * 100).toFixed(1) : 0;
          }
        });

        const now = Date.now();
        const elapsed = (now - lastTs) / 1000;
        const bitrate = Math.round(((bytesSent - lastBytesSent) * 8) / elapsed / 1000); // kbps
        lastBytesSent = bytesSent;
        lastTs = now;

        // Quality score: excellent / good / poor / bad
        let quality = "excellent";
        if (rtt > 300 || packetLoss > 5)  quality = "poor";
        else if (rtt > 150 || packetLoss > 2) quality = "good";
        else if (rtt > 400 || packetLoss > 10) quality = "bad";

        const q = { rtt, packetLoss: Number(packetLoss), bitrate, quality };
        setNetworkQuality(q);
        socket.emit("network-stats", { roomId, stats: q });
      } catch (_) {}
    }, 3000);
  }, [roomId]);

  // ── Create RTCPeerConnection ─────────────────────────────
  const createPeer = useCallback(() => {
    const peer = new RTCPeerConnection(ICE_CONFIG);

    peer.onicecandidate = (e) => {
      if (e.candidate) socket.emit("ice-candidate", { candidate: e.candidate, roomId });
    };

    peer.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
        // iOS Safari requires explicit .play() — autoPlay alone is not enough
        // for remotely-set srcObject on unmuted video elements.
        remoteVideoRef.current.play().catch(() => {});
      }
      onStatusChange("connected");
      startStatsPolling();
    };

    peer.onconnectionstatechange = () => {
      const s = peer.connectionState;
      console.log("Peer state:", s);
      if (s === "failed") { onStatusChange("reconnecting"); peer.restartIce(); }
      if (s === "disconnected" || s === "closed") onStatusChange("peer-left");
    };

    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "failed") peer.restartIce();
    };

    return peer;
  }, [roomId, remoteVideoRef, onStatusChange, startStatsPolling]);

  // ── Get local camera/mic with noise suppression ──────────
  const startLocalStream = useCallback(async () => {
    // Use relaxed constraints so mobile cameras (especially iOS) don't reject
    const raw = await navigator.mediaDevices.getUserMedia({
      video: {
        width:  { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24 },
        facingMode: "user",
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Apply Web Audio noise suppression on top of browser native
    const processed = await applyNoiseSuppression(raw);
    localStreamRef.current = processed;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = processed;
      localVideoRef.current.play().catch(() => {}); // iOS explicit play
    }
    return processed;
  }, [localVideoRef]);

  // ── Create offer (no forced codec — let browser negotiate) ──
  const createOptimizedOffer = useCallback(async (peer) => {
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    // Apply bandwidth limits only; do NOT force VP9 — iOS doesn't support it
    const optimized = new RTCSessionDescription({
      type: offer.type,
      sdp: applyBandwidth(offer.sdp),
    });
    await peer.setLocalDescription(optimized);
    return optimized;
  }, []);

  // ── Join room ────────────────────────────────────────────
  const joinRoom = useCallback(async () => {
    await startLocalStream();
    socket.emit("join-room", { roomId, userName });
  }, [roomId, userName, startLocalStream]);

  // ── Toggle mic ───────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; return track.enabled; }
    return false;
  }, []);

  // ── Toggle camera ────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; return track.enabled; }
    return false;
  }, []);

  // ── Screen share ─────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen share, revert to camera
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;

      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack && peerRef.current) {
        const sender = peerRef.current.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(camTrack);
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setIsScreenSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always", displaySurface: "monitor" },
          audio: false,
        });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];

        // Replace video track in peer connection
        if (peerRef.current) {
          const sender = peerRef.current.getSenders().find((s) => s.track?.kind === "video");
          if (sender) await sender.replaceTrack(screenTrack);
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;

        // Auto-revert when user stops sharing from browser UI
        screenTrack.onended = () => toggleScreenShare();
        setIsScreenSharing(true);
      } catch (e) {
        console.warn("Screen share cancelled:", e);
      }
    }
  }, [isScreenSharing, localVideoRef]);

  // ── Send chat ─────────────────────────────────────────────
  const sendChat = useCallback((text) => {
    socket.emit("chat-message", { roomId, text });
    // Echo locally
    onChat({ from: userName, text, ts: Date.now(), self: true });
  }, [roomId, userName, onChat]);

  // ── Apply encoding params after connection ───────────────
  const applyEncodingParams = useCallback(async (peer) => {
    for (const sender of peer.getSenders()) {
      if (sender.track?.kind === "video") {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 1_500_000; // 1.5 Mbps
        params.encodings[0].maxFramerate = 30;
        params.encodings[0].networkPriority = "high";
        try { await sender.setParameters(params); } catch (_) {}
      }
      if (sender.track?.kind === "audio") {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 64_000; // 64 kbps audio
        try { await sender.setParameters(params); } catch (_) {}
      }
    }
  }, []);

  // ── Socket event listeners ───────────────────────────────
  useEffect(() => {
    socket.on("user-joined", async ({ initiator, peerName }) => {
      onStatusChange(initiator ? "calling" : "ringing");
      if (initiator) {
        const peer = createPeer();
        peerRef.current = peer;
        localStreamRef.current?.getTracks().forEach((t) => peer.addTrack(t, localStreamRef.current));
        const offer = await createOptimizedOffer(peer);
        socket.emit("offer", { offer, roomId });
      }
    });

    socket.on("offer", async ({ offer }) => {
      const peer = createPeer();
      peerRef.current = peer;
      localStreamRef.current?.getTracks().forEach((t) => peer.addTrack(t, localStreamRef.current));
      await peer.setRemoteDescription(new RTCSessionDescription(offer));

      let answer = await peer.createAnswer();
      // Apply bandwidth only — no VP9 forcing for mobile compatibility
      answer = new RTCSessionDescription({
        type: answer.type,
        sdp: applyBandwidth(answer.sdp),
      });
      await peer.setLocalDescription(answer);
      socket.emit("answer", { answer, roomId });
      await applyEncodingParams(peer);
    });

    socket.on("answer", async ({ answer }) => {
      await peerRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
      await applyEncodingParams(peerRef.current);
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      try { await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    });

    socket.on("chat-message", ({ from, text, ts }) => {
      onChat({ from, text, ts, self: false });
    });

    socket.on("peer-network-stats", ({ stats }) => {
      // Could show peer's quality too — stored separately if needed
    });

    socket.on("peer-disconnected", () => {
      clearInterval(statsIntervalRef.current);
      onStatusChange("peer-left");
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });

    socket.on("room-full",  () => onStatusChange("room-full"));
    socket.on("waiting",    ({ roomId: rid }) => onStatusChange("waiting"));

    return () => {
      socket.off("user-joined"); socket.off("offer"); socket.off("answer");
      socket.off("ice-candidate"); socket.off("chat-message");
      socket.off("peer-network-stats"); socket.off("peer-disconnected");
      socket.off("room-full"); socket.off("waiting");
    };
  }, [roomId, createPeer, createOptimizedOffer, applyEncodingParams, remoteVideoRef, onStatusChange, onChat]);

  return { joinRoom, toggleMic, toggleCamera, toggleScreenShare, sendChat, cleanup, networkQuality, isScreenSharing };
}
