import { useState } from "react";
import { session } from "../session";
import { useStore } from "../store";
import { t, type Key } from "../i18n";
import type { Status } from "../net/protocol";

const OPTIONS: Status[] = ["available", "busy", "away", "invisible"];
export const statusColor: Record<string, string> = { available: "#5ec26a", busy: "#e5584f", away: "#f2d14b", invisible: "#8e8e9a", offline: "#8e8e9a" };

export function StatusMenu() {
  const status = useStore((s) => s.status);
  const [open, setOpen] = useState(false);
  return (
    <div className="status-menu">
      <button className="btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className="dot" style={{ background: statusColor[status] }} />
        {t(("status." + status) as Key)}
      </button>
      {open && (
        <ul className="menu" role="listbox">
          {OPTIONS.map((o) => (
            <li key={o}>
              <button role="option" aria-selected={o === status} onClick={() => { session.setStatus(o); setOpen(false); }}>
                <i className="dot" style={{ background: statusColor[o] }} />
                {t(("status." + o) as Key)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
