import React, { useEffect, useRef, useState } from "react";
import { subscribeWS } from "../ws.js";
import { getSetting, subscribeSettings, updateSettings } from "../settings.js";
import Icon from "../icons.jsx";

// ---------- chat transform ----------
// Raw /agent traffic is human -> ai(tool_calls) -> tool results [-> ai text].
// Larry usually puts his reply in the speak() tool and sends NO final text,
// so we render: tools row -> ONE merged result row -> Larry's speak text as
// his chat bubble. Real final text (when present) supersedes the speak echo.

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

function buildItems(messages) {
  const items = [];
  let pendingSpeak = [];
  const flushSpeak = () => {
    for (const s of pendingSpeak) items.push(s);
    pendingSpeak = [];
  };

  for (const m of messages) {
    if (m.role === "human") {
      flushSpeak();
      items.push({ kind: "human", key: m.seq, m });
    } else if (m.role === "ai") {
      const calls = m.tool_calls || [];
      if (m.content) pendingSpeak = []; // real text supersedes the speak echo
      else flushSpeak(); // a new round is starting: emit last round's speech
      if (calls.length) {
        items.push({ kind: "tools", key: `t${m.seq}`, calls, ts: m.ts });
        for (const tc of calls) {
          if (tc.name === "speak") {
            const text = tc.args?.text || tc.args?.message;
            if (text) pendingSpeak.push({ kind: "speech", key: `s${m.seq}`, text, ts: m.ts });
          }
        }
      }
      if (m.content) {
        items.push({
          kind: "ai",
          key: m.seq,
          m,
          pseudo: calls.length === 0 ? parsePseudoCall(m.content) : null,
        });
      }
    } else if (m.role === "tool") {
      const last = items[items.length - 1];
      if (last && last.kind === "results") last.results.push(m);
      else items.push({ kind: "results", key: `r${m.seq}`, results: [m], ts: m.ts });
    }
  }
  flushSpeak();
  return items;
}

function Item({ it }) {
  if (it.kind === "human") {
    return (
      <div className="msg human">
        <div className="t">{fmtTime(it.m.ts)}</div>
        <div className="bubble">{it.m.content}</div>
      </div>
    );
  }
  if (it.kind === "tools") {
    return (
      <div className="tools">
        {it.calls.map((tc, i) => (
          <details key={i} className="toolcall" open={it.toolsOpen || undefined}>
            <summary>{tc.name}</summary>
            <pre>{JSON.stringify(tc.args, null, 1)}</pre>
          </details>
        ))}
      </div>
    );
  }
  if (it.kind === "results") {
    const n = it.results.length;
    return (
      <div className="tools">
        <details className="toolcall result" open={it.toolsOpen || undefined}>
          <summary>{n > 1 ? `results · ${n}` : "result"}</summary>
          <pre>{it.results.map((r) => r.content).join("\n———\n")}</pre>
        </details>
      </div>
    );
  }
  if (it.kind === "speech") {
    return (
      <div className="msg ai">
        <div className="t">{fmtTime(it.ts)} · spoke</div>
        <div className="bubble">{it.text}</div>
      </div>
    );
  }
  // kind === "ai"
  return (
    <div className="msg ai">
      <div className="t">{fmtTime(it.m.ts)}</div>
      <div className="bubble">
        {it.pseudo ? (
          <>
            {it.pseudo.text && <div>{it.pseudo.text}</div>}
            <details className="toolcall warn">
              <summary>{it.pseudo.name} — written as text, NOT executed</summary>
              <pre>{JSON.stringify(it.pseudo.args, null, 1)}</pre>
            </details>
          </>
        ) : (
          it.m.content
        )}
      </div>
    </div>
  );
}

// "Larry is working…": pending while the latest turn still has unanswered
// tool calls (or no reply at all). 120 s safety cap for wedged runs.
function isWorking(messages, sending) {
  if (sending) return true;
  if (messages.length === 0) return false;
  const tail = messages[messages.length - 1];
  if (!tail.ts || Date.now() / 1000 - tail.ts > 120) return false;
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "human") i--;
  if (i < 0) return false;
  if (tail.role === "human") return true;
  let calls = 0;
  let results = 0;
  for (let j = i + 1; j < messages.length; j++) {
    const m = messages[j];
    if (m.role === "ai") calls += (m.tool_calls || []).length;
    else if (m.role === "tool") results++;
  }
  return results < calls;
}

// ---------- quick actions ----------

// The G1 firmware's full arm-preset vocabulary (verified against SDK source).
export const ARM_PRESETS = [
  "HighWave", "FaceWave", "Clap", "HighFive", "Handshake", "Hug", "HandsUp",
  "ArmHeart", "RightHeart", "RightHandUp", "LeftKiss", "XRay", "Reject", "CancelAction",
];

function QuickActions() {
  // Selection lives in bridge settings — same buttons on every device.
  const [selected, setSelected] = useState(() => getSetting("quick_actions", []));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null);

  useEffect(
    () => subscribeSettings((s) => setSelected(s?.quick_actions || [])),
    []
  );

  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    setSelected(next);
    updateSettings({ quick_actions: next });
  };

  const run = async (name) => {
    if (busy) return;
    setBusy(name);
    setLast(null);
    try {
      const res = await fetch("/api/skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "execute_arm_command", args: { command_name: name } }),
      });
      const data = await res.json();
      setLast(`${name}: ${data.ok ? data.result : data.error}`);
    } catch {
      setLast(`${name}: bridge unreachable`);
    }
    setBusy(null);
  };

  return (
    <div className="qa">
      <h3>
        Quick Actions
        <button className="editbtn ctl" onClick={() => setEditing(!editing)}>
          <Icon name="sliders" />{editing ? "done" : "edit"}
        </button>
      </h3>
      {editing ? (
        <div className="qa-editor">
          {ARM_PRESETS.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
      ) : (
        <div className="row">
          {selected.map((name) => (
            <button key={name} className="qbtn ctl" disabled={!!busy} onClick={() => run(name)}>
              {busy === name ? "…" : name}
            </button>
          ))}
          {selected.length === 0 && <span style={{ color: "var(--txt-3)", fontSize: 12 }}>No presets — edit to add</span>}
        </div>
      )}
      {last && <div className="last" title={last}>{last}</div>}
    </div>
  );
}

// ---------- the panel ----------

export default function AgentPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [, setTick] = useState(0); // re-evaluate the working window over time
  const [chatOpts, setChatOpts] = useState(() => ({
    size: getSetting("chat.text_size", 13),
    open: getSetting("chat.tools_expanded", false),
  }));
  const scrollRef = useRef(null);

  useEffect(
    () =>
      subscribeSettings(() =>
        setChatOpts({
          size: getSetting("chat.text_size", 13),
          open: getSetting("chat.tools_expanded", false),
        })
      ),
    []
  );

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

  const working = isWorking(messages, sending);

  useEffect(() => {
    if (!working) return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(iv);
  }, [working]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, working]);

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

  const clear = async () => {
    try {
      await fetch("/api/chat/clear", { method: "POST" });
      setMessages([]);
    } catch {
      /* bridge unreachable */
    }
  };

  const items = buildItems(messages);

  return (
    <div className="agent">
      <header>
        <h3>AGENT CHAT</h3>
        <button className="clearbtn ctl" onClick={clear} title="Clear conversation">
          <Icon name="trash" />clear
        </button>
      </header>
      <div className="chatlog" ref={scrollRef} style={{ fontSize: chatOpts.size }}>
        {items.length === 0 && (
          <div className="chat-empty">No conversation yet — say something below.</div>
        )}
        {items.map((it) => (
          <Item key={it.key} it={{ ...it, toolsOpen: chatOpts.open }} />
        ))}
        {working && (
          <div className="working">
            <span className="dots"><i /><i /><i /></span> Larry is working…
          </div>
        )}
      </div>
      {error && <div className="chat-error">{error}</div>}
      <div className="composer">
        <input
          value={input}
          placeholder="Tell the robot…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={sending}
        />
        <button className="sendbtn" onClick={send} disabled={sending || !input.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
      <QuickActions />
    </div>
  );
}
