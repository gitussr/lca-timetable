'use client';

import { useEffect, useState } from 'react';
import AppHeader from './app-header';
import TimetableGrid from './timetable-grid';
import RosterFooter from './roster-footer';
import ThemeSwitcher from './theme-switcher';
import CellEditor, { type EditTarget } from './cell-editor';
import SettingsPanel from './settings-panel';
import UsersPanel from './users-panel';
import { emptySeats } from '@/lib/timetable-view';
import { useTimetable } from '@/lib/use-timetable';
import { useRealtime, type ConnectionState } from '@/lib/use-realtime';
import { roleAtLeast, type Role, type Theme } from '@/lib/constants';
import type { TimetableData } from '@/lib/timetable-data';

/**
 * Client shell holding the timetable's state.
 *
 * Editing is a mode on the existing grid rather than a separate screen (§21,
 * §38, §39): the timetable stays the primary view, the same cells are the
 * targets, and the controls are two floating buttons beside the theme switcher
 * — a spot the design already uses for chrome, so the grid layout is untouched.
 */
export default function TimetableApp({
  initial,
  preferredTheme,
  role,
  userId,
  userName,
}: {
  initial: TimetableData;
  preferredTheme: Theme | null;
  role: Role;
  userId: string;
  userName: string;
}) {
  const store = useTimetable(initial);
  const { data, save } = store;

  const canEdit = roleAtLeast(role, 'editor');
  const isAdmin = roleAtLeast(role, 'admin');
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [remoteEditor, setRemoteEditor] = useState<string | null>(null);

  /**
   * Live updates from other editors (§23). Applying the server's document
   * directly means two browsers converge rather than drifting.
   */
  const connection = useRealtime({
    selfId: userId,
    onEvent: store.applyRemote,
    onRemoteEdit: setRemoteEditor,
    onResync: store.refresh,
  });

  // Name whoever last changed something, then fade it. Deliberately quiet:
  // a toast per keystroke from a colleague would be unusable.
  useEffect(() => {
    if (!remoteEditor) return;
    const id = setTimeout(() => setRemoteEditor(null), 2600);
    return () => clearTimeout(id);
  }, [remoteEditor]);

  // The clock and the today/live highlight both need real client time. Held
  // here so the grid and header cannot disagree about what minute it is.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // The highlight only changes on a minute boundary; the header runs its own
    // one-second clock. Polling this faster would re-render the whole grid.
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const seats = emptySeats(data.settings, data.schedules.length);

  return (
    <div id="app" className={editing ? 'editing' : undefined}>
      <ThemeSwitcher initialTheme={preferredTheme} />

      {/*
        Role-gated in the UI only so viewers are not shown controls that would
        fail; the server refuses regardless of what the browser renders (§8).
      */}
      {canEdit && (
        <div className="edit-switcher">
          {editing && isAdmin && (
            <button
              type="button"
              className="edit-fab"
              aria-label="Accounts"
              title="Accounts"
              onClick={() => setUsersOpen(true)}
            >
              <i className="bi bi-people" aria-hidden="true" />
            </button>
          )}
          {editing && (
            <button
              type="button"
              className="edit-fab"
              aria-label="Timetable settings"
              title="Timetable settings"
              onClick={() => setSettingsOpen(true)}
            >
              <i className="bi bi-sliders" aria-hidden="true" />
            </button>
          )}
          {editing && (
            <button
              type="button"
              className="edit-fab"
              aria-label="Add a student"
              title="Add a student"
              onClick={(e) =>
                setTarget({ kind: 'new', anchor: e.currentTarget.getBoundingClientRect() })
              }
            >
              <i className="bi bi-person-plus" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="edit-fab"
            aria-pressed={editing}
            aria-label={editing ? 'Leave edit mode' : 'Edit timetable'}
            title={editing ? 'Leave edit mode' : 'Edit timetable'}
            onClick={() => {
              setEditing((v) => !v);
              setTarget(null);
            }}
          >
            <i className={editing ? 'bi bi-check2' : 'bi bi-pencil'} aria-hidden="true" />
          </button>
        </div>
      )}

      <AppHeader emptySeats={seats} userName={userName} />

      {!data.seeded && (
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '8px 0' }}>
          No timetable data yet — run <code>npm run seed</code>.
        </p>
      )}

      <TimetableGrid
        settings={data.settings}
        students={data.students}
        schedules={data.schedules}
        courses={data.courses}
        now={now}
        editing={editing}
        onPick={setTarget}
      />

      <RosterFooter
        students={data.students}
        courses={data.courses}
        editing={editing}
        onPick={setTarget}
      />

      {target && (
        <CellEditor
          target={target}
          store={store}
          role={role}
          onClose={() => setTarget(null)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel store={store} role={role} onClose={() => setSettingsOpen(false)} />
      )}

      {usersOpen && isAdmin && (
        <UsersPanel selfId={userId} onClose={() => setUsersOpen(false)} />
      )}

      <ConnectionBadge state={connection} remoteEditor={remoteEditor} />
      <SaveStatus state={save} onDismiss={store.dismissError} />
    </div>
  );
}

/**
 * Says when the live connection is NOT live (§43).
 *
 * Silent while everything works — a permanent "connected" badge is noise. It
 * only appears when updates have stopped arriving in realtime, because that is
 * the state a collaborator needs to know about.
 */
function ConnectionBadge({
  state,
  remoteEditor,
}: {
  state: ConnectionState;
  remoteEditor: string | null;
}) {
  if (remoteEditor && state === 'live') {
    return (
      <div className="conn-badge" role="status" aria-live="polite">
        <span className="conn-dot live" /> {remoteEditor} just made a change
      </div>
    );
  }
  if (state === 'live') return null;

  const label =
    state === 'connecting'
      ? 'Reconnecting…'
      : state === 'polling'
        ? 'Live updates unavailable — refreshing every 15s'
        : 'Offline';

  return (
    <div className="conn-badge" role="status" aria-live="polite">
      <span className={'conn-dot ' + state} /> {label}
    </div>
  );
}

/**
 * Saving / Saved / Unable to save (§44). Deliberately a single line rather than
 * a spinner over the grid: the optimistic update already put the change on
 * screen, so the only thing worth reporting is whether it stuck.
 */
function SaveStatus({
  state,
  onDismiss,
}: {
  state: ReturnType<typeof useTimetable>['save'];
  onDismiss: () => void;
}) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'saving') {
    return (
      <div className="save-status" role="status" aria-live="polite">
        <i className="bi bi-arrow-repeat" aria-hidden="true" /> Saving…
      </div>
    );
  }

  if (state.kind === 'saved') {
    return (
      <div className="save-status saved" role="status" aria-live="polite">
        <i className="bi bi-check2" aria-hidden="true" /> Saved
      </div>
    );
  }

  return (
    <div className="save-status error" role="alert">
      <i className="bi bi-exclamation-triangle" aria-hidden="true" />
      <span>{state.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
