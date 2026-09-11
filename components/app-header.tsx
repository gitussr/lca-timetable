'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

/** `formatDateWithDay` from the legacy script.js, unchanged. */
function formatDateWithDay(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${days[date.getDay()]}, ${dd}/${mm}/${date.getFullYear()}`;
}

/** `getCurrentTime` from the legacy script.js — 12-hour, zero-padded, with seconds. */
function formatClock(date: Date): string {
  const hours = String(date.getHours() % 12 || 12).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
}

/**
 * The header bar: date, brand link, empty-seat count, live clock, sign out.
 *
 * Sign out lived in the theme panel until 2026-09-11, behind the floating
 * palette button and below a divider — present, tested, and effectively
 * undiscoverable. It reads as a missing feature, which is how it was reported.
 *
 * Accounts sits here for the same reason. It was first put beside the timetable
 * settings, which meant admin → edit mode → people icon: three steps to reach
 * the only way to add a colleague, and it was reported missing too. Managing
 * people is not editing the timetable, so it does not belong behind edit mode.
 *
 * The clock renders blank on the server and fills in on mount. Rendering a
 * server timestamp would hydrate against a different client second and throw a
 * mismatch — and the server's timezone is not the academy's anyway.
 */
export default function AppHeader({
  emptySeats,
  userName,
  isAdmin,
  onOpenAccounts,
}: {
  emptySeats: number;
  userName: string;
  isAdmin: boolean;
  onOpenAccounts: () => void;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header>
      <div id="today" className="text-sm font-medium">
        {now ? `Today: ${formatDateWithDay(now)}` : ''}
      </div>

      <a href="https://learncomputer.in/" target="_blank" rel="noopener noreferrer" className="brand-link">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192x192.png" alt="" width={22} height={22} /> Learn Computer Academy
      </a>

      <div className="flex items-center gap-6">
        <span id="empty-seats" className="text-sm font-medium">
          Empty Seats: {emptySeats}+
        </span>
        <div id="time" className="text-sm font-medium flex items-center gap-2">
          {now && (
            <>
              <i className="bi bi-clock" aria-hidden="true" /> {formatClock(now)}
            </>
          )}
        </div>
        {isAdmin && (
          <button
            type="button"
            className="header-signout"
            title="Add and manage accounts"
            onClick={onOpenAccounts}
          >
            <i className="bi bi-people" aria-hidden="true" />
            <span>Accounts</span>
          </button>
        )}
        <button
          type="button"
          className="header-signout"
          title={`Sign out of ${userName}'s account`}
          onClick={() => void signOut({ callbackUrl: '/login' })}
        >
          <i className="bi bi-box-arrow-right" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}
