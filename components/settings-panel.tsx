'use client';

import { useEffect, useRef, useState } from 'react';
import type { CourseWire } from '@/lib/serialize';
import type { TimeRange } from '@/lib/types';
import type { useTimetable } from '@/lib/use-timetable';
import { COURSE_ICONS, DAYS, roleAtLeast, toMinutes, type Role } from '@/lib/constants';

/**
 * Timetable configuration (§40).
 *
 * This is the screen that removes the four-slot limitation for good: an editor
 * adds a column here and the grid grows, with no source change and no deploy.
 * The legacy page needed edits in three places — the CSS `repeat(4, …)`, five
 * `.header-row` divs, and script.js's `dayIndex * 4 + i` arithmetic — and
 * missing the third broke the "live" highlight silently.
 *
 * Deliberately a panel rather than a popover: the range list needs room, and
 * this is the one place in the app where a dialog genuinely beats inline
 * controls (§39).
 */
export default function SettingsPanel({
  store,
  role,
  onClose,
}: {
  store: ReturnType<typeof useTimetable>;
  role: Role;
  onClose: () => void;
}) {
  const { data } = store;
  const isAdmin = roleAtLeast(role, 'admin');
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [confirmRange, setConfirmRange] = useState<string | null>(null);
  const [confirmCourse, setConfirmCourse] = useState<string | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** How many classes sit in a range — shown so removal is an informed choice. */
  function occupancy(r: TimeRange): number {
    return data.schedules.filter(
      (s) => s.startTime === r.startTime && s.endTime === r.endTime,
    ).length;
  }

  function addRange(): void {
    setRangeError(null);
    if (!newStart || !newEnd) {
      setRangeError('Set both a start and an end time.');
      return;
    }
    if (toMinutes(newEnd) <= toMinutes(newStart)) {
      setRangeError('The end time must be after the start time.');
      return;
    }
    if (data.settings.timeRanges.some((r) => r.startTime === newStart && r.endTime === newEnd)) {
      setRangeError('That column already exists.');
      return;
    }

    const next: TimeRange[] = [
      ...data.settings.timeRanges,
      {
        id: (newStart + '-' + newEnd).replace(/:/g, ''),
        startTime: newStart,
        endTime: newEnd,
        order: data.settings.timeRanges.length,
      },
    ].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

    void store.setTimeRanges(next);
    setNewStart('');
    setNewEnd('');
  }

  function removeRange(id: string): void {
    setConfirmRange(null);
    void store.setTimeRanges(data.settings.timeRanges.filter((r) => r.id !== id));
  }

  function toggleDay(day: string): void {
    const has = data.settings.days.includes(day);
    const next = has
      ? data.settings.days.filter((d) => d !== day)
      : [...data.settings.days, day];
    // Keep calendar order regardless of the click order.
    next.sort((a, b) => DAYS.indexOf(a as never) - DAYS.indexOf(b as never));
    if (next.length === 0) return;
    void store.updateSettings({ days: next });
  }

  return (
    <>
      <button
        type="button"
        className="pop-backdrop panel-backdrop"
        aria-label="Close settings"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Timetable settings"
        ref={ref}
      >
        <div className="panel-head">
          <h4>Timetable settings</h4>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="panel-body">
          {/* ---------------------------------------------- time ranges */}
          <section className="panel-section">
            <h5>Columns</h5>
            <p className="panel-hint">
              Each column is a recurring weekly time range. Add or remove them here — the
              timetable adapts on its own.
            </p>

            <ul className="range-list">
              {data.settings.timeRanges.map((r) => {
                const used = occupancy(r);
                return (
                  <li key={r.id}>
                    <span className="range-time">
                      {r.startTime}<span className="range-sep">–</span>{r.endTime}
                    </span>
                    <span className="range-count">
                      {used === 0 ? 'empty' : used + (used === 1 ? ' class' : ' classes')}
                    </span>
                    <button
                      type="button"
                      className="range-remove"
                      aria-label={`Remove the ${r.startTime} to ${r.endTime} column`}
                      onClick={() => setConfirmRange(r.id)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>

            {confirmRange && (
              <div className="pop-confirm">
                {(() => {
                  const r = data.settings.timeRanges.find((x) => x.id === confirmRange);
                  if (!r) return null;
                  const used = occupancy(r);
                  return (
                    <>
                      <p>
                        Remove the <strong>{r.startTime}–{r.endTime}</strong> column?
                        {used > 0
                          ? ` ${used} class${used === 1 ? '' : 'es'} still sit${used === 1 ? 's' : ''} in it — the server will refuse until they are moved or cleared.`
                          : ' It is empty, so nothing is lost.'}
                      </p>
                      <div className="pop-actions row">
                        <button type="button" className="btn center" onClick={() => setConfirmRange(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn danger center"
                          onClick={() => removeRange(r.id)}
                        >
                          Remove column
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="range-add">
              <div>
                <label htmlFor="rg-start">Start</label>
                <input
                  id="rg-start"
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="rg-end">End</label>
                <input
                  id="rg-end"
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />
              </div>
              <button type="button" className="btn primary" onClick={addRange}>
                Add column
              </button>
            </div>
            {rangeError && <p className="field-error">{rangeError}</p>}
          </section>

          {/* ---------------------------------------------------- days */}
          {isAdmin && (
            <section className="panel-section">
              <h5>Days</h5>
              <p className="panel-hint">Which days the academy runs. Sunday is off by default.</p>
              <div className="day-toggles">
                {DAYS.map((d) => {
                  const on = data.settings.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={on ? 'day-chip on' : 'day-chip'}
                      aria-pressed={on}
                      onClick={() => toggleDay(d)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* -------------------------------------------------- layout */}
          {isAdmin && (
            <section className="panel-section">
              <h5>Layout</h5>
              <div className="panel-grid">
                <div>
                  <label htmlFor="st-cap">Rows per cell</label>
                  <input
                    id="st-cap"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={data.settings.slotCapacity}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== data.settings.slotCapacity && v >= 1 && v <= 20) {
                        void store.updateSettings({ slotCapacity: v });
                      }
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="st-div">Empty-seat divisor</label>
                  <input
                    id="st-div"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={data.settings.emptySeatDivisor}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== data.settings.emptySeatDivisor && v >= 1 && v <= 10) {
                        void store.updateSettings({ emptySeatDivisor: v });
                      }
                    }}
                  />
                </div>
              </div>
              <p className="panel-hint">
                The header reads{' '}
                <code>
                  floor((days × columns × rows − classes) / divisor)
                </code>
                . The divisor is the legacy formula&apos;s unexplained{' '}
                <code>3</code>, kept so the number stays familiar.
              </p>
            </section>
          )}

          {/* ------------------------------------------------- courses */}
          {isAdmin && (
            <section className="panel-section">
              <h5>Courses</h5>
              <p className="panel-hint">
                Defaults for new classes, not limits on existing ones — a student&apos;s own
                schedule always wins.
              </p>
              {data.courses.map((c) => (
                <CourseRow
                  key={c.id}
                  course={c}
                  store={store}
                  studentCount={data.students.filter((s) => s.courseId === c.id).length}
                  confirming={confirmCourse === c.id}
                  onConfirm={() => setConfirmCourse(c.id)}
                  onCancel={() => setConfirmCourse(null)}
                />
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function CourseRow({
  course,
  store,
  studentCount,
  confirming,
  onConfirm,
  onCancel,
}: {
  course: CourseWire;
  store: ReturnType<typeof useTimetable>;
  studentCount: number;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="course-row">
      <div className="course-head">
        <strong>{course.name}</strong>
        <span className="range-count">
          {studentCount} student{studentCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="range-remove"
          aria-label={`Delete the ${course.name} course`}
          onClick={onConfirm}
        >
          ×
        </button>
      </div>

      <div className="panel-grid three">
        <div>
          <label htmlFor={'c-dur-' + course.id}>Minutes</label>
          <input
            id={'c-dur-' + course.id}
            type="number"
            min={15}
            max={720}
            defaultValue={course.defaultDuration}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== course.defaultDuration && v >= 15 && v <= 720) {
                void store.updateCourse(course, { defaultDuration: v });
              }
            }}
          />
        </div>
        <div>
          <label htmlFor={'c-spw-' + course.id}>Days/wk</label>
          <input
            id={'c-spw-' + course.id}
            type="number"
            min={1}
            max={6}
            defaultValue={course.sessionsPerWeek}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== course.sessionsPerWeek && v >= 1 && v <= 6) {
                void store.updateCourse(course, { sessionsPerWeek: v });
              }
            }}
          />
        </div>
        <div>
          <label htmlFor={'c-icon-' + course.id}>Icon</label>
          <select
            id={'c-icon-' + course.id}
            defaultValue={course.icon}
            onChange={(e) => void store.updateCourse(course, { icon: e.target.value })}
          >
            {COURSE_ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>

      {confirming && (
        <div className="pop-confirm">
          <p>
            Delete <strong>{course.name}</strong>?
            {studentCount > 0
              ? ` ${studentCount} student${studentCount === 1 ? '' : 's'} still take${studentCount === 1 ? 's' : ''} it — the server will refuse until they move to another course.`
              : ' No students take it, so nothing is orphaned.'}
          </p>
          <div className="pop-actions row">
            <button type="button" className="btn center" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger center"
              onClick={() => {
                onCancel();
                void store.removeCourse(course);
              }}
            >
              Delete course
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
