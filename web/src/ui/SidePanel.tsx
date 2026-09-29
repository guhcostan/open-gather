import { useEffect, useMemo, useRef, useState } from "react";
import { session } from "../session";
import { getState, setState, useStore } from "../store";
import { t, type Key } from "../i18n";
import { AvatarCanvas } from "./AvatarEditor";
import { ChatIcon, PinIcon, SendIcon, UsersIcon } from "./Icons";
import { statusColor } from "./StatusMenu";

type Scope = { sc: "o" | "g" } | { sc: "d"; peer: number };

export function SidePanel() {
  const [tab, setTab] = useState<"people" | "chat" | "">("people");
  const [scope, setScope] = useState<Scope>({ sc: "o" });
  const unread = useStore((s) => s.unread);
  useEffect(() => {
    if (tab === "chat") setState({ unread: 0 });
  }, [tab, unread]);
  return (
    <aside className={"side" + (tab ? " open" : "")}>
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab(tab === "people" ? "" : "people")} title={t("roster.title")}>
          <UsersIcon />
        </button>
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab(tab === "chat" ? "" : "chat")} title={t("chat.title")}>
          <ChatIcon />
          {unread > 0 && tab !== "chat" && <b className="badge">{unread > 9 ? "9+" : unread}</b>}
        </button>
      </nav>
      {tab === "people" && <People onDm={(peer) => { setScope({ sc: "d", peer }); setTab("chat"); }} />}
      {tab === "chat" && <Chat scope={scope} setScope={setScope} />}
    </aside>
  );
}

function People({ onDm }: { onDm: (id: number) => void }) {
  const roster = useStore((s) => s.roster);
  const me = useStore((s) => s.meId);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const rank: Record<string, number> = { available: 0, busy: 1, away: 2, invisible: 3, offline: 4 };
    return [...roster.values()]
      .filter((p) => p.n.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0) || rank[a.s] - rank[b.s] || a.n.localeCompare(b.n));
  }, [roster, q, me]);
  return (
    <section className="panel" aria-label={t("roster.title")}>
      <h2>{t("roster.title")} <small>{[...roster.values()].filter((p) => p.s !== "offline").length}</small></h2>
      <input className="search" placeholder="🔍" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("roster.title")} />
      <ul className="people">
        {list.map((p) => (
          <li key={p.id}>
            <AvatarCanvas av={p.av} size={2} />
            <div className="who">
              <span className="nm">{p.n}{p.id === me && <em> ({t("hud.you")})</em>}</span>
              <span className="st"><i className="dot" style={{ background: statusColor[p.s] }} />{t(("status." + p.s) as Key)}{p.r === "admin" ? " · admin" : ""}</span>
            </div>
            {p.id !== me && p.s !== "offline" && (
              <div className="acts">
                <button title={t("roster.locate")} aria-label={t("roster.locate")} onClick={() => session.locate(p.id)}><PinIcon /></button>
                <button title={t("roster.dm")} aria-label={t("roster.dm")} onClick={() => onDm(p.id)}><ChatIcon /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chat({ scope, setScope }: { scope: Scope; setScope: (s: Scope) => void }) {
  const chat = useStore((s) => s.chat);
  const roster = useStore((s) => s.roster);
  const me = useStore((s) => s.meId);
  const conv = useStore((s) => s.conv);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const peer = scope.sc === "d" ? scope.peer : 0;
  const msgs = chat.filter((m) => {
    if (scope.sc === "o") return m.sc === "o";
    if (scope.sc === "g") return m.sc === "g";
    return m.sc === "d" && (m.from === peer || m.to === peer);
  });
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length, scope]);
  const name = (id: number) => roster.get(id)?.n ?? "?";
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    session.chat(scope.sc, v, scope.sc === "d" ? scope.peer : undefined);
    setText("");
  };
  const dmPeers = [...new Set(getState().chat.filter((m) => m.sc === "d").map((m) => (m.from === me ? m.to! : m.from)))];
  return (
    <section className="panel chat" aria-label={t("chat.title")}>
      <div className="chips">
        <button className={"chip" + (scope.sc === "o" ? " on" : "")} onClick={() => setScope({ sc: "o" })}>{t("chat.office")}</button>
        <button className={"chip" + (scope.sc === "g" ? " on" : "")} onClick={() => setScope({ sc: "g" })}>{t("chat.conversation")}</button>
        {dmPeers.map((id) => (
          <button key={id} className={"chip" + (scope.sc === "d" && scope.peer === id ? " on" : "")} onClick={() => setScope({ sc: "d", peer: id })}>{name(id)}</button>
        ))}
        {scope.sc === "d" && !dmPeers.includes(scope.peer) && <button className="chip on">{name(scope.peer)}</button>}
      </div>
      <div className="msgs" aria-live="polite">
        {scope.sc === "g" && !conv && <p className="muted">{t("chat.noConv")}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={"msg" + (m.from === me ? " mine" : "")}>
            <b>{m.from === me ? t("media.you") : roster.get(m.from)?.n ?? m.n ?? "?"}</b>
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={scope.sc === "d" ? t("chat.dmWith", { name: name(scope.peer) }) : t("chat.placeholder")} aria-label={t("chat.placeholder")} />
        <button aria-label={t("chat.send")}><SendIcon /></button>
      </form>
    </section>
  );
}
