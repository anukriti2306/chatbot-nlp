import { useEffect, useRef, useState } from "react";
import { getHealth, getLanguages, translate, ORIGIN } from "./api.js";

const SUGGESTIONS = [
  "Paste a paragraph to translate",
  "Attach a .pdf and translate it",
  "Translate a .docx into Hindi",
  "Translate a short story into Tamil",
];

const GlobeChatIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="13" r="8" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3 13h16M11 5c2 2.2 3 5 3 8s-1 5.8-3 8c-2-2.2-3-5-3-8s1-5.8 3-8Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M15 6.5h5.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-1.2v2.2L17 13h-1" fill="#fff" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const LogoIcon = ({ size = 20 }) => (
  <svg className="logo" width={size} height={size} viewBox="0 0 48 48" fill="none">
    <rect x="4" y="6" width="40" height="36" rx="6" stroke="currentColor" strokeWidth="2.2" />
    <line x1="4" y1="15" x2="44" y2="15" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="10.5" cy="10.5" r="1.3" fill="currentColor" />
    <circle cx="15" cy="10.5" r="1.3" fill="currentColor" />
    <circle cx="19.5" cy="10.5" r="1.3" fill="currentColor" />
    <rect x="10" y="21" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M13.2 25.5h7.6M17 23.3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M14 31.3c1.6-1.4 4.4-1.4 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M29 22.5h9M29 27h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M27 30l9.5 9.5 1.8-1.8-3.6-3.6h5.2l-4.9-6.8-8-1.4Z" fill="currentColor" />
  </svg>
);

function LangMenu({ langs, lang, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="langMenu" ref={ref}>
      <button type="button" className="langTrigger" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <GlobeChatIcon />
        <span>{lang}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={open ? "chev up" : "chev"}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="langList" role="listbox">
          {langs.map((l) => (
            <li key={l}>
              <button
                type="button"
                className={l === lang ? "active" : ""}
                role="option"
                aria-selected={l === lang}
                onClick={() => { onChange(l); setOpen(false); }}
              >
                {l}
                {l === lang && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({ m }) {
  if (m.role === "me") {
    return (
      <div className="msg me">
        {m.fileName && (
          <div className="fileTag">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v5a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            <span>{m.fileName}</span>
          </div>
        )}
        {m.text && <div>{m.text}</div>}
      </div>
    );
  }

  if (m.pending) {
    const pct = m.total > 1 ? Math.round((m.done / m.total) * 100) : null;
    return (
      <div className="msg bot progress">
        <span className="dots"><i /><i /><i /></span>
        <span className="progressLabel">
          {pct === null ? "Translating…" : `Translating sentence ${m.done} of ${m.total}…`}
        </span>
        {pct !== null && (
          <div className="progressTrack"><div className="progressFill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
    );
  }

  if (m.error) return <div className="msg bot"><span className="err">{m.text}</span></div>;

  return (
    <div className="msg bot result">
      <div className="resultHead">
        <span className="tag">{m.lang}</span>
        <span className="meta">{m.sentence_count} sentence{m.sentence_count === 1 ? "" : "s"} · {m.char_count.toLocaleString()} characters</span>
      </div>

      <div className="resultBlock">
        <span className="blockLabel">{m.lang} text</span>
        <p className="targetText">{m.text}</p>
      </div>

      {m.pronunciation && (
        <div className="resultBlock">
          <span className="blockLabel">How to pronounce it</span>
          <p className="pronText">{m.pronunciation}</p>
        </div>
      )}

      {m.download_url && (
        <a className="downloadBtn" href={ORIGIN + m.download_url} download>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Download translated PDF
        </a>
      )}
    </div>
  );
}

export default function App() {
  const [langs, setLangs] = useState([]);
  const [lang, setLang] = useState("Kannada");
  const [status, setStatus] = useState("connecting");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  // Load languages, then poll until the model is ready
  useEffect(() => {
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          setLangs(await getLanguages());
          while (!stop && !(await getHealth()).ready) {
            setStatus("loading");
            await new Promise((r) => setTimeout(r, 3000));
          }
          if (!stop) { setReady(true); setStatus("ready"); }
          return;
        } catch {
          setStatus("offline");
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 200) + "px";
  }, [text]);

  async function send(preset) {
    const t = (preset ?? text).trim();
    if (!ready || busy || (!t && !file)) return;
    const f = file;
    setMessages((m) => [
      ...m,
      { role: "me", fileName: f?.name, text: t },
      { role: "bot", pending: true, done: 0, total: 1 },
    ]);
    setText(""); setFile(null); setBusy(true);
    if (fileRef.current) fileRef.current.value = "";
    let reply;
    try {
      const r = await translate({ lang, text: t, file: f }, ({ done, total }) => {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.pending) copy[copy.length - 1] = { ...last, done, total };
          return copy;
        });
      });
      reply = { role: "bot", lang: r.lang, text: r.translation, pronunciation: r.pronunciation,
                sentence_count: r.sentence_count, char_count: r.char_count, download_url: r.download_url };
    } catch (e) {
      reply = { role: "bot", error: true, text: e.message };
    }
    setMessages((m) => [...m.slice(0, -1), reply]);
    setBusy(false);
  }

  const started = messages.length > 0;
  const statusLabel = { connecting: "Connecting…", loading: "Loading model…", ready: "Ready", offline: "Offline" }[status];

  return (
    <main className={`app ${started ? "started" : ""}`}>
      <div className="topbar">
        <span className="brand"><LogoIcon /> Translator <span className="lang">· English to Indian languages</span></span>
        <div className="statusPill" data-state={status}>
          <span className="dot" />{statusLabel}
        </div>
      </div>

      <div className="stage">
        {!started && (
          <div className="hero">
            <h1>What would you like translated?</h1>
            <p>Paste text, or attach a .txt, .pdf or .docx file.</p>
          </div>
        )}

        {started && (
          <div className="chat" ref={chatRef}>
            {messages.map((m, i) => <Message key={i} m={m} />)}
          </div>
        )}

        <div className="composerWrap">
          <div className="composer">
            {file && (
              <div className="filePill">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v5a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                <span>{file.name}</span>
                <button aria-label="Remove file" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>×</button>
              </div>
            )}
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              placeholder="Translate anything…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <div className="row">
              <button className="icon" title="Attach a document" aria-label="Attach a document" onClick={() => fileRef.current.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx" hidden onChange={(e) => setFile(e.target.files[0] || null)} />

              <div className="langSelect">
                <LangMenu langs={langs} lang={lang} onChange={setLang} />
              </div>

              <span className="sp" />
              <button className="send" aria-label="Translate" disabled={!ready || busy || (!text.trim() && !file)} onClick={() => send()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>

          {!started && (
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => setText(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}