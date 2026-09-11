'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { ROLES, type Role } from '@/lib/constants';
import type { UserWire } from '@/lib/serialize';

/**
 * Account management (§7, §33).
 *
 * There is deliberately no self-registration. Accounts exist because an admin
 * made one — a public signup form on a timetable would let any stranger who
 * finds the URL read the academy's schedule and its students' names, which is
 * the exact exposure the LCA1234 access code used to create.
 *
 * Until this panel existed, the only way to add a colleague was
 * `npm run create:admin -- --role=editor` on a machine holding the production
 * credentials. The endpoints had been there and RBAC-tested since phase 5;
 * nothing in the UI called them.
 *
 * Every destructive rule lives on the server — last admin, self-demotion,
 * duplicate email — so this panel does not re-implement them. It shows what the
 * server says, which is why the refusals read as full sentences.
 */
export default function UsersPanel({
  selfId,
  onClose,
}: {
  selfId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const [users, setUsers] = useState<UserWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<{ users: UserWire[] }>('/api/users');
    if (res.ok) { setUsers(res.data.users); setError(null); }
    else setError(res.detail ?? res.error);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setFields({});
    setError(null);
    const res = await api.post<{ user: UserWire }>('/api/users', { name, email, password, role });
    setAdding(false);
    if (res.ok) {
      setUsers((u) => [...(u ?? []), res.data.user].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setEmail(''); setPassword(''); setRole('editor');
      return;
    }
    if (res.fields) setFields(res.fields);
    setError(res.detail ?? res.error);
  }

  /** One place for PATCH, because every refusal is shaped the same way. */
  async function patch(u: UserWire, changes: Record<string, unknown>) {
    setBusy(u.id);
    setError(null);
    const res = await api.patch<{ user: UserWire }>('/api/users/' + u.id, {
      ...changes,
      version: u.version,
    });
    setBusy(null);
    if (res.ok) {
      setUsers((list) => (list ?? []).map((x) => (x.id === u.id ? res.data.user : x)));
      return;
    }
    setError(res.detail ?? res.error);
    // A 409 means our copy is stale as well as refused.
    if (res.status === 409) void load();
  }

  async function deactivate(u: UserWire) {
    setConfirmOff(null);
    setBusy(u.id);
    setError(null);
    const res = await api.del('/api/users/' + u.id);
    setBusy(null);
    if (res.ok) { void load(); return; }
    setError(res.detail ?? res.error);
  }

  return (
    <>
      <button
        type="button"
        className="pop-backdrop panel-backdrop"
        aria-label="Close accounts"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="panel" role="dialog" aria-modal="true" aria-label="Accounts" ref={ref}>
        <div className="panel-head">
          <h4>Accounts</h4>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="panel-body">
          {error && <p className="panel-error" role="alert">{error}</p>}

          <section className="panel-section">
            <h5>Add someone</h5>
            <p className="panel-hint">
              There is no sign-up page — accounts are made here, by an admin. An
              <strong> editor</strong> can change the timetable; a <strong>viewer</strong> can only
              read it.
            </p>

            <form onSubmit={(e) => void add(e)}>
              <div className="panel-grid">
                <div>
                  <label htmlFor="u-name">Name</label>
                  <input
                    id="u-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={Boolean(fields.name)}
                    required
                  />
                  {fields.name && <p className="field-error">{fields.name}</p>}
                </div>
                <div>
                  <label htmlFor="u-email">Email</label>
                  <input
                    id="u-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={Boolean(fields.email)}
                    required
                  />
                  {fields.email && <p className="field-error">{fields.email}</p>}
                </div>
              </div>

              <div className="panel-grid">
                <div>
                  <label htmlFor="u-password">Password</label>
                  <input
                    id="u-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(fields.password)}
                    autoComplete="new-password"
                    required
                  />
                  {fields.password && <p className="field-error">{fields.password}</p>}
                </div>
                <div>
                  <label htmlFor="u-role">Role</label>
                  <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button type="submit" className="btn primary center" disabled={adding}>
                {adding ? 'Creating…' : 'Create account'}
              </button>
            </form>
          </section>

          <section className="panel-section">
            <h5>Everyone</h5>
            {users === null && <p className="panel-hint">Loading…</p>}
            {users?.length === 0 && <p className="panel-hint">No accounts yet.</p>}

            <ul className="user-list">
              {(users ?? []).map((u) => (
                <li key={u.id} className={u.active ? undefined : 'is-inactive'}>
                  <div className="user-who">
                    <span className="user-name">
                      {u.name}
                      {u.id === selfId && <span className="user-you"> you</span>}
                    </span>
                    <span className="user-email">{u.email}</span>
                  </div>

                  <select
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    disabled={busy === u.id || !u.active}
                    onChange={(e) => void patch(u, { role: e.target.value })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>

                  {u.active ? (
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busy === u.id}
                      onClick={() => setConfirmOff(u.id)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === u.id}
                      onClick={() => void patch(u, { active: true })}
                    >
                      Reactivate
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {confirmOff && (() => {
              const u = (users ?? []).find((x) => x.id === confirmOff);
              if (!u) return null;
              return (
                <div className="pop-confirm">
                  <p>
                    Deactivate <strong>{u.name}</strong>? They are signed out immediately —
                    the session they already hold stops working on its next request, not
                    whenever it expires. The account is kept, not deleted, because the audit
                    log refers to it.
                  </p>
                  <div className="pop-actions row">
                    <button type="button" className="btn center" onClick={() => setConfirmOff(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn danger center"
                      onClick={() => void deactivate(u)}
                    >
                      Deactivate
                    </button>
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      </div>
    </>
  );
}
