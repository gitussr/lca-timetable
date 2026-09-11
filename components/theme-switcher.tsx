'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES, type Theme } from '@/lib/constants';

/** Labels are part of the design (§6) and must keep their exact wording. */
const THEME_LABELS: Record<Theme, string> = {
  theme1: 'Midnight Pro',
  theme2: 'Violet Glass',
  theme3: 'Deep Ocean',
  theme4: 'Cyber Lime',
  theme5: 'Graphite Ember',
};

export const THEME_STORAGE_KEY = 'selectedTheme';

/**
 * Theme switcher, ported from the legacy `.theme-switcher` markup and
 * `setupThemeSwitcher()`.
 *
 * The theme still applies instantly via `document.documentElement`, and still
 * persists to localStorage so the login screen and a signed-out visit keep it.
 * What is new: it also saves to the user's account, so the preference follows
 * them to another device (§6).
 */
export default function ThemeSwitcher({ initialTheme }: { initialTheme: Theme | null }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * The server already stamped the account's theme onto <html> (see
   * app/layout.tsx), so this is not what applies it — it mirrors the account
   * preference into localStorage so the LOGIN screen, which has no session to
   * read, opens in the same theme next time.
   */
  useEffect(() => {
    if (!initialTheme) return;
    document.documentElement.setAttribute('data-theme', initialTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, initialTheme);
    } catch {
      /* private mode */
    }
  }, [initialTheme]);

  // Click-outside closes the panel, as in the original.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  function choose(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* private mode */
    }
    // Fire-and-forget: a failed save must not block the visible change.
    void fetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredTheme: theme }),
    }).catch(() => undefined);
  }

  return (
    <div className="theme-switcher">
      <button
        id="themeToggle"
        ref={buttonRef}
        aria-label="Change theme"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="bi bi-palette" aria-hidden="true" />
      </button>

      <div className={open ? 'theme-panel active' : 'theme-panel'} id="themePanel" ref={panelRef}>
        <h4>Theme</h4>
        {THEMES.map((theme) => (
          <button key={theme} data-theme={theme} onClick={() => choose(theme)}>
            <span className="swatch" data-swatch={theme} />
            {THEME_LABELS[theme]}
          </button>
        ))}
      </div>
    </div>
  );
}
