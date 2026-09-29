import { useState } from "react";
import { AvatarEditor } from "./AvatarEditor";
import { saveAvatar, setState, useStore } from "../store";
import { t } from "../i18n";

export function JoinScreen() {
  const av = useStore((s) => s.myAvatar);
  const [name, setName] = useState(() => localStorage.getItem("og.name") ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const invite = new URLSearchParams(location.search).get("invite") ?? "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), avatar: av, invite }) });
      if (!r.ok) throw new Error(String(r.status));
      if (invite) history.replaceState(null, "", location.pathname); // do not keep the invite token in the address bar
      localStorage.setItem("og.name", name.trim());
      setState({ phase: "play" });
    } catch {
      setErr(t("join.error"));
      setBusy(false);
    }
  };

  return (
    <main className="join">
      <form className="join-card" onSubmit={submit}>
        <h1>{t("join.title")}</h1>
        <p className="muted">{t("join.subtitle")}</p>
        <label className="field">
          <span>{t("join.name")}</span>
          <input autoFocus maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <AvatarEditor value={av} onChange={saveAvatar} />
        {err && <p className="error" role="alert">{err}</p>}
        <button className="primary" disabled={busy || !name.trim()}>{t("join.enter")}</button>
      </form>
    </main>
  );
}
