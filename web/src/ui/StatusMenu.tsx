import { useState } from "react";
import { session } from "../session";
import { useStore } from "../store";
import { t, type Key } from "../i18n";
import type { Status } from "../net/protocol";

const OPTIONS: Status[] = ["available", "busy", "away", "invisible"];
export const statusColor: Record<string, string> = { available: "#5ec26a", busy: "#e5584f", away: "#f2d14b", invisible: "#8e8e9a", offline: "#8e8e9a" };

export function StatusMenu() {
  const status = useStore((s) => s.status);
  const myNote = useStore((s) => s.roster.get(s.meId)?.m ?? "");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="status-menu">
      <button className="btn" aria-expanded={open} aria-controls="status-menu" onClick={() => { setNote(myNote); setOpen(!open); }} title={myNote || undefined}>
        <i className="dot" style={{ background: statusColor[status] }} />
        {t(("status." + status) as Key)}
      </button>
      {open && (
        <ul className="menu" id="status-menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          {OPTIONS.map((o) => (
            <li key={o}>
              <button aria-pressed={o === status} onClick={() => { session.setStatus(o); setOpen(false); }}>
                <i className="dot" style={{ background: statusColor[o] }} />
                {t(("status." + o) as Key)}
              </button>
            </li>
          ))}
          <li>
            <form className="note-form" onSubmit={(e) => { e.preventDefault(); session.note(note.trim()); setOpen(false); }}>
              <input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder={t("note.placeholder")} aria-label={t("note.label")} />
              <button className="btn" type="submit">{t("note.save")}</button>
              {myNote && <button className="btn" type="button" onClick={() => { session.note(""); setNote(""); setOpen(false); }}>{t("note.clear")}</button>}
            </form>
          </li>
        </ul>
      )}
    </div>
  );
}
