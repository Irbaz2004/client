import { useState, useRef, useCallback, useEffect } from "react";
import { useWebRTC } from "./hooks/useWebRTC";
import NetworkQuality from "./components/NetworkQuality";
import ChatPanel from "./components/ChatPanel";
import "./App.css";

const STATUS_LABEL = {
  idle: "", joining: "Joining...",
  waiting: "Waiting for peer...", calling: "Connecting...",
  ringing: "Peer found!", connected: "Live",
  reconnecting: "Reconnecting...", "peer-left": "Peer disconnected",
  "room-full": "Room is full",
};

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function App() {
  const [screen, setScreen]       = useState("lobby");
  const [roomId, setRoomId]       = useState("");
  const [inputRoom, setInputRoom] = useState("");
  const [userName, setUserName]   = useState("");
  const [status, setStatus]       = useState("idle");
  const [micOn, setMicOn]         = useState(true);
  const [camOn, setCamOn]         = useState(true);
  const [chatOpen, setChatOpen]   = useState(false);
  const [messages, setMessages]   = useState([]);
  const [unread, setUnread]       = useState(0);
  const [duration, setDuration]   = useState(0);
  const [copied, setCopied]       = useState(false);

  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const timerRef       = useRef(null);

  const handleStatusChange = useCallback((s) => setStatus(s), []);

  const handleChat = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
    if (!msg.self) setUnread((u) => u + 1);
  }, []);

  const {
    joinRoom, toggleMic, toggleCamera,
    toggleScreenShare, sendChat, cleanup,
    networkQuality, isScreenSharing,
  } = useWebRTC({
    roomId, userName,
    localVideoRef, remoteVideoRef,
    onStatusChange: handleStatusChange,
    onChat: handleChat,
  });

  // Timer
  useEffect(() => {
    if (status === "connected") {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      if (status !== "connected") setDuration(0);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // Reset unread on chat open
  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen, messages]);

  const fmt = (s) =>
    `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const handleJoin = async () => {
    const name = userName.trim() || "Guest";
    const id   = inputRoom.trim() || genRoomId();
    setUserName(name);
    setRoomId(id);
    setScreen("call");
    setStatus("joining");
    setTimeout(() => joinRoom(), 80);
  };

  const handleLeave = () => {
    cleanup();
    setScreen("lobby"); setStatus("idle");
    setMessages([]); setUnread(0);
    setChatOpen(false); setInputRoom("");
    setRoomId(""); setMicOn(true); setCamOn(true);
  };

  const handleToggleMic = () => { const e = toggleMic(); setMicOn(e ?? !micOn); };
  const handleToggleCam = () => { const e = toggleCamera(); setCamOn(e ?? !camOn); };

  const copyRoom = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app">
      <div className="bg-blob blob-1" />
      <div className="bg-blob blob-2" />
      <div className="bg-blob blob-3" />
      <div className="noise" />

      {/* ── LOBBY ── */}
      {screen === "lobby" && (
        <div className="lobby">
          <div className="lobby-card">
            <div className="logo-wrap">
              <div className="logo-icon">
                <svg width="36" height="36" viewBox="0 0 40 40" fill="none">
                  <rect x="2" y="8" width="26" height="18" rx="3" stroke="#a78bfa" strokeWidth="2"/>
                  <path d="M28 16l10-5v14l-10-5V16z" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round"/>
                  <circle cx="10" cy="17" r="3" fill="#7c3aed"/>
                  <circle cx="18" cy="17" r="3" fill="#5b21b6"/>
                </svg>
              </div>
              <div>
                <h1 className="lobby-title">RuzixMeet</h1>
                <p className="lobby-version">v2 · Enhanced</p>
              </div>
            </div>

            <p className="lobby-sub">
              Pure P2P · VP9 Codec · Noise Suppressed · Screen Share
            </p>

            <div className="field-row">
              <div className="input-group">
                <label>Your Name</label>
                <input
                  className="room-input"
                  placeholder="Enter your name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  maxLength={24}
                />
              </div>
              <div className="input-group">
                <label>Room ID</label>
                <input
                  className="room-input"
                  placeholder="Auto-generate if blank"
                  value={inputRoom}
                  onChange={(e) => setInputRoom(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  maxLength={10}
                />
              </div>
            </div>

            <button className="join-btn" onClick={handleJoin}>
              <span className="btn-glow" />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Start Call
            </button>

            <div className="feature-grid">
              {[
                ["🎙", "Noise Suppression"],
                ["🖥", "Screen Share"],
                ["💬", "In-call Chat"],
                ["📶", "Network Quality"],
                ["🎨", "VP9 Codec"],
                ["🌐", "Cross-browser"],
              ].map(([icon, label]) => (
                <div key={label} className="feature-tag">
                  <span>{icon}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CALL SCREEN ── */}
      {screen === "call" && (
        <div className="call-screen">

          {/* Header */}
          <div className="call-header">
            <div className="header-left">
              <span className="logo-sm">RuzixMeet</span>
              <button className="room-badge" onClick={copyRoom}>
                <span className="room-label">ROOM</span>
                <span className="room-id">{roomId}</span>
                <span className="copy-icon">
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                  )}
                </span>
              </button>
            </div>

            <div className="header-center">
              {status === "connected" && (
                <div className="timer-live">
                  <span className="live-dot" />
                  {fmt(duration)}
                </div>
              )}
            </div>

            <div className="header-right">
              <NetworkQuality quality={networkQuality} />
              <div className={`status-pill s-${status}`}>
                {STATUS_LABEL[status] || status}
              </div>
            </div>
          </div>

          {/* Video area */}
          <div className="video-area">
            {/* Remote */}
            <div className={`video-main ${status !== "connected" ? "empty" : ""}`}>
              <video ref={remoteVideoRef} autoPlay playsInline className="vid" />
              {status !== "connected" && (
                <div className="vid-placeholder">
                  <div className="pulse-ring" />
                  <div className="pulse-ring r2" />
                  <div className="pulse-ring r3" />
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.2">
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                  </svg>
                  <p>{status === "waiting" ? "Share Room ID to invite someone" : (STATUS_LABEL[status] || "...")}</p>
                  {status === "waiting" && (
                    <button className="share-btn" onClick={copyRoom}>
                      {copied ? "Copied!" : "Copy Room ID"}
                    </button>
                  )}
                </div>
              )}
              <div className="vid-tag remote-tag">Remote</div>
            </div>

            {/* Local PiP */}
            <div className="video-pip">
              <video ref={localVideoRef} autoPlay playsInline muted className={`vid ${!isScreenSharing ? "mirror" : ""}`} />
              {!camOn && !isScreenSharing && (
                <div className="cam-off">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
                    <line x1="2" y1="2" x2="22" y2="22"/>
                    <path d="M7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 001.73-1"/>
                    <path d="M9.5 4H18a2 2 0 012 2v9.5"/>
                    <path d="M16 16l7 4V8"/>
                  </svg>
                </div>
              )}
              {isScreenSharing && <div className="screen-badge">Screen</div>}
              <div className="vid-tag local-tag">{userName || "You"}</div>
            </div>

            {/* Chat panel */}
            <ChatPanel
              messages={messages}
              onSend={sendChat}
              visible={chatOpen}
            />
          </div>

          {/* Controls */}
          <div className="controls">
            <button
              className={`ctrl ${micOn ? "ctrl-on" : "ctrl-off"}`}
              onClick={handleToggleMic}
              title={micOn ? "Mute" : "Unmute"}
            >
              {micOn ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="2" y1="2" x2="22" y2="22"/>
                  <path d="M18.89 13.23A7.12 7.12 0 0019 12v-2M5 10v2a7 7 0 0012 5M15 9.34V4a3 3 0 00-5.68-1.33M9 9v3a3 3 0 005.12 2.12"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
              <span>{micOn ? "Mute" : "Unmute"}</span>
            </button>

            <button
              className={`ctrl ${camOn ? "ctrl-on" : "ctrl-off"}`}
              onClick={handleToggleCam}
              title={camOn ? "Off Camera" : "On Camera"}
            >
              {camOn ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z"/>
                  <rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="2" y1="2" x2="22" y2="22"/>
                  <path d="M7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 001.73-1M9.5 4H18a2 2 0 012 2v9.5"/>
                  <path d="M16 16l7 4V8"/>
                </svg>
              )}
              <span>{camOn ? "Camera" : "No Cam"}</span>
            </button>

            <button
              className={`ctrl ${isScreenSharing ? "ctrl-active" : "ctrl-on"}`}
              onClick={toggleScreenShare}
              title="Screen Share"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              <span>{isScreenSharing ? "Stop Share" : "Share"}</span>
            </button>

            <button
              className={`ctrl ${chatOpen ? "ctrl-active" : "ctrl-on"} chat-ctrl`}
              onClick={() => setChatOpen((o) => !o)}
              title="Chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              {unread > 0 && <span className="unread-badge">{unread}</span>}
              <span>Chat</span>
            </button>

            <button className="ctrl ctrl-end" onClick={handleLeave} title="End Call">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91"/>
                <line x1="23" y1="1" x2="1" y2="23"/>
              </svg>
              <span>End</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
