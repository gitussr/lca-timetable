'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

/**
 * Login screen. A one-to-one port of the legacy #loginScreen markup against the
 * same class names in globals.css, so the appearance is unchanged (§5) — what
 * changed is underneath: a real per-user credential instead of a shared access
 * code compiled into client JavaScript (§6.6, §7).
 *
 * Gone from the original: the triple-tap-the-logo backdoor that bypassed the
 * code entirely, and the forgeable `localStorage.lca_authed` flag.
 */

/** Auth.js `code` values from auth.ts, mapped to something a person can act on. */
const MESSAGES: Record<string, string> = {
  'invalid-credentials': 'Those details do not match an account. Try again.',
  'too-many-attempts': 'Too many attempts. Wait 15 minutes and try again.',
};
const FALLBACK = 'Could not sign you in. Try again.';

export default function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (MESSAGES[initialError] ?? FALLBACK) : null,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn('credentials', {
      email,
      password,
      rememberMe: String(rememberMe),
      redirect: false,
    });

    if (result?.error) {
      setError(MESSAGES[result.code ?? ''] ?? FALLBACK);
      setPassword('');
      setBusy(false);
      return;
    }

    // Full refresh so the server components pick up the new session.
    router.replace('/');
    router.refresh();
  }

  return (
    <div id="loginScreen" className="login-screen" style={{ display: 'flex' }}>
      <div className="login-noise" />
      <div className="login-card">
        <div className="login-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192x192.png" alt="Learn Computer Academy" />
        </div>
        <h1 className="login-title">Learn Computer Academy</h1>
        <p className="login-sub">Sign in to view and edit the timetable</p>

        <form onSubmit={onSubmit} autoComplete="on" noValidate>
          <div className="field">
            <label htmlFor="emailInput">Email</label>
            <div className="input-wrap">
              <input
                id="emailInput"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="passwordInput">Password</label>
            <div className="input-wrap">
              <input
                id="passwordInput"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <i className={showPassword ? 'bi bi-eye-slash' : 'bi bi-eye'} aria-hidden="true" />
              </button>
            </div>
          </div>

          <label className="remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span className="checkbox-box" aria-hidden="true">
              <i className="bi bi-check" />
            </span>
            Remember me on this device
          </label>

          <button type="submit" className="login-btn" disabled={busy}>
            {busy ? 'Signing in…' : 'Unlock timetable'}
            {!busy && <i className="bi bi-arrow-right" aria-hidden="true" />}
          </button>

          {/* role="alert" so a screen reader announces it without a focus move (§46). */}
          <p
            className={error ? 'login-error show' : 'login-error'}
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        </form>
      </div>
    </div>
  );
}
