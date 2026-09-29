import { useCallback, useEffect, useState } from "react";
import { toast, useStore } from "../store";
import { hasKey, t, type Key } from "../i18n";
import { Modal } from "./Modal";

type Tab = "members" | "invites" | "activity";
interface Member { id: number; name: string; role: "admin" | "member"; joinedAt: number }
interface InviteRow { id: number; role: string; maxUses: number; uses: number; expiresAt: number; createdAt: number; createdBy: string; status: string }
interface AuditRow { id: number; actor: string; action: string; target: string; detail: string; at: number }

async function api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T & { error?: string } }> {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: (await r.json().catch(() => ({}))) as T & { error?: string } };
}

const when = (sec: number) => new Date(sec * 1000).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

export function AdminDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("members");
  return (
    <Modal title={t("admin.title")} onClose={onClose} wide>
      <div className="chips" role="tablist" aria-label={t("admin.title")}>
        {(["members", "invites", "activity"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{t(("admin.tab." + k) as Key)}</button>
        ))}
      </div>
      {tab === "members" && <Members />}
      {tab === "invites" && <Invites />}
      {tab === "activity" && <Activity />}
      <div className="modal-actions"><button className="primary" onClick={onClose}>{t("settings.close")}</button></div>
    </Modal>
  );
}

function Members() {
  const [rows, setRows] = useState<Member[] | null>(null);
  const [you, setYou] = useState(0);
  const [confirm, setConfirm] = useState(0);
  const load = useCallback(async () => {
    const r = await api<{ members: Member[]; you: number }>("GET", "/api/admin/members");
    if (r.ok) { setRows(r.json.members); setYou(r.json.you); } else toast(t("admin.error"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const setRole = async (m: Member, role: string) => {
    const r = await api("PATCH", "/api/admin/members/" + m.id, { role });
    toast(r.ok ? t("admin.roleChanged", { name: m.name }) : r.json.error ?? t("admin.error"));
    void load();
  };
  const remove = async (m: Member) => {
    setConfirm(0);
    const r = await api("DELETE", "/api/admin/members/" + m.id);
    toast(r.ok ? t("admin.removed", { name: m.name }) : r.json.error ?? t("admin.error"));
    void load();
  };
  if (!rows) return <p className="muted" role="status">{t("admin.loading")}</p>;
  return (
    <table className="admin-table">
      <caption className="sr-only">{t("admin.tab.members")}</caption>
      <thead><tr><th scope="col">{t("admin.name")}</th><th scope="col">{t("admin.role")}</th><th scope="col">{t("admin.joined")}</th><th scope="col"><span className="sr-only">{t("admin.actions")}</span></th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td>{m.name}{m.id === you && <em> ({t("hud.you")})</em>}</td>
            <td>
              <select value={m.role} aria-label={t("admin.roleOf", { name: m.name })} onChange={(e) => void setRole(m, e.target.value)}>
                <option value="member">{t("admin.role.member")}</option>
                <option value="admin">{t("admin.role.admin")}</option>
              </select>
            </td>
            <td>{when(m.joinedAt)}</td>
            <td>
              {m.id !== you && (confirm === m.id ? (
                <span className="inline">
                  <button className="btn danger" onClick={() => void remove(m)}>{t("admin.confirmRemove")}</button>
                  <button className="btn" onClick={() => setConfirm(0)}>{t("media.cancel")}</button>
                </span>
              ) : (
                <button className="btn" aria-label={t("admin.removeOf", { name: m.name })} onClick={() => setConfirm(m.id)}>{t("admin.remove")}</button>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Invites() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [role, setRole] = useState("member");
  const [uses, setUses] = useState(10);
  const [hours, setHours] = useState(24);
  const [link, setLink] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ invites: InviteRow[] }>("GET", "/api/admin/invites");
    if (r.ok) setRows(r.json.invites); else toast(t("admin.error"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    const r = await api<{ path: string }>("POST", "/api/invites", { role, maxUses: uses, hours });
    if (!r.ok) return toast(r.json.error ?? t("invite.error"));
    setLink(location.origin + r.json.path);
    void load();
  };
  const revoke = async (i: InviteRow) => {
    const r = await api("DELETE", "/api/admin/invites/" + i.id);
    toast(r.ok ? t("admin.revoked") : r.json.error ?? t("admin.error"));
    void load();
  };
  return (
    <>
      <div className="admin-form">
        <label className="field"><span>{t("admin.role")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">{t("admin.role.member")}</option>
            <option value="admin">{t("admin.role.admin")}</option>
          </select>
        </label>
        <label className="field"><span>{t("admin.maxUses")}</span>
          <input type="number" min={1} max={1000} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
        </label>
        <label className="field"><span>{t("admin.hours")}</span>
          <input type="number" min={1} max={2160} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(2160, Number(e.target.value) || 1)))} />
        </label>
        <button className="btn" onClick={() => void create()}>{t("invite.create")}</button>
      </div>
      {link && (
        <div className="composer">
          <input readOnly value={link} aria-label={t("invite.title")} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => { void navigator.clipboard.writeText(link); toast(t("invite.copied")); }}>{t("invite.copy")}</button>
        </div>
      )}
      <small className="muted">{t("admin.inviteHint")}</small>
      {!rows ? <p className="muted" role="status">{t("admin.loading")}</p> : rows.length === 0 ? <p className="muted">{t("admin.noInvites")}</p> : (
        <table className="admin-table">
          <caption className="sr-only">{t("admin.tab.invites")}</caption>
          <thead><tr><th scope="col">{t("admin.role")}</th><th scope="col">{t("admin.uses")}</th><th scope="col">{t("admin.expires")}</th><th scope="col">{t("admin.status")}</th><th scope="col"><span className="sr-only">{t("admin.actions")}</span></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>{t(("admin.role." + i.role) as Key)}</td>
                <td>{i.uses}/{i.maxUses}</td>
                <td>{when(i.expiresAt)}</td>
                <td>{t(("admin.invite." + i.status) as Key)}</td>
                <td>{i.status === "active" && <button className="btn" aria-label={t("admin.revokeOf", { date: when(i.createdAt) })} onClick={() => void revoke(i)}>{t("admin.revoke")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Activity() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    void api<{ entries: AuditRow[] }>("GET", "/api/admin/audit").then((r) => (r.ok ? setRows(r.json.entries) : toast(t("admin.error"))));
  }, []);
  if (!rows) return <p className="muted" role="status">{t("admin.loading")}</p>;
  if (rows.length === 0) return <p className="muted">{t("admin.noActivity")}</p>;
  return (
    <ul className="audit" tabIndex={0} aria-label={t("admin.tab.activity")}>
      {rows.map((e) => {
        const key = "admin.audit." + e.action;
        const text = hasKey(key) ? t(key, { actor: e.actor, target: e.target, detail: e.detail }) : `${e.actor}: ${e.action}`;
        return <li key={e.id}><time>{when(e.at)}</time> {text}</li>;
      })}
    </ul>
  );
}

export function AdminButton({ onOpen }: { onOpen: () => void }) {
  const role = useStore((s) => s.role);
  if (role !== "admin") return null;
  return <button className="btn" onClick={onOpen}>{t("admin.open")}</button>;
}
