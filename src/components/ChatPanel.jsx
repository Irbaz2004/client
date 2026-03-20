import { useState, useRef, useEffect } from "react";

export default function ChatPanel({ messages, onSend, visible }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, visible]);

  const handleSend = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput("");
  };

  const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`chat-panel ${visible ? "chat-open" : "chat-closed"}`}>
      <div className="chat-header">
        <span className="chat-title">Messages</span>
        <span className="chat-count">{messages.length}</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <span>No messages yet</span>
            <small>Say hello 👋</small>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.self ? "self" : "peer"}`}>
            <div className="msg-bubble">
              <span className="msg-text">{msg.text}</span>
            </div>
            <div className="msg-meta">
              <span className="msg-from">{msg.self ? "You" : msg.from}</span>
              <span className="msg-time">{fmt(msg.ts)}</span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          maxLength={500}
        />
        <button className="chat-send" onClick={handleSend} disabled={!input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
