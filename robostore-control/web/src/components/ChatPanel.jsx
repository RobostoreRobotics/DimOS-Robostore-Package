import React, { useEffect, useRef, useState } from "react";
import { subscribeWS } from "../ws.js";

function ToolCall({ name, args }) {
  return (
    <details className="toolcall">
      <summary>⚙ {name}</summary>
      <pre>{JSON.stringify(args, null, 1)}</pre>
    </details>
  );
}

// Weak models sometimes write a tool call as plain text — `name("…")\n{json}` —
// instead of a structured call. Nothing executes; render it readably and say so.
function parsePseudoCall(content) {
  const m = content.match(/^(\w+)\([\s\S]*?\)\s*\n(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  try {
    const args = JSON.parse(m[2]);
    return { name: m[1], args, text: args.text || args.message || "" };
  } catch {
    return null;
  }
}

function Message({ m }) {
  if (m.role === "human") {
    return <div className="msg human">{m.content}</div>;
  }
  if (m.role === "tool") {
    return (
      <details className="toolcall result">
        <summary>→ result</summary>
        <pre>{m.content}</pre>
      </details>
    );
  }
  // ai
  const pseudo = m.content && (m.tool_calls || []).length === 0 ? parsePseudoCall(m.content) : null;
  return (
    <div className="msg ai">
      {pseudo ? (
        <>
          {pseudo.text && <div>{pseudo.text}</div>}
          <details className="toolcall warn">
            <summary>⚠ {pseudo.name} — written as text, NOT executed</summary>
            <pre>{JSON.stringify(pseudo.args, null, 1)}</pre>
          </details>
        </>
      ) : (
        m.content && <div>{m.content}</div>
      )}
      {(m.tool_calls || []).map((tc, i) => (
        <ToolCall key={i} name={tc.name} args={tc.args} />
      ))}
    </div>
  );
}

export default function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(
    () =>
      subscribeWS("/ws/chat", (data) => {
        try {
          const ev = JSON.parse(data);
          if (ev.type === "history") setMessages(ev.messages);
          else if (ev.type === "append") setMessages((prev) => [...prev, ...ev.messages]);
        } catch {
          /* ignore malformed frames */
        }
      }),
    []
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (data.ok) setInput("");
      else setError(data.error || "send failed");
    } catch {
      setError("bridge unreachable");
    }
    setSending(false);
  };

  return (
    <div className="card chat-card">
      <h3>Agent Chat</h3>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="placeholder">No conversation yet — say something below.</div>
        )}
        {messages.map((m) => (
          <Message key={m.seq} m={m} />
        ))}
      </div>
      {error && <div className="chat-error">{error}</div>}
      <div className="chat-input">
        <input
          value={input}
          placeholder="Tell the robot…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
