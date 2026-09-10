'use client';

import { useMemo, useState } from 'react';
import Popover from './popover';
import StudentFields, { type StudentDraft } from './student-fields';
import type { ScheduleWire, StudentWire } from '@/lib/serialize';
import type { TimetableData } from '@/lib/timetable-data';
import type { useTimetable } from '@/lib/use-timetable';
import { roleAtLeast, type Role } from '@/lib/constants';

export type EditTarget =
  | { kind: 'entry'; anchor: DOMRect; schedule: ScheduleWire; student: StudentWire }
  | { kind: 'empty'; anchor: DOMRect; day: string; rangeId: string }
  | { kind: 'new'; anchor: DOMRect }
  | { kind: 'student'; anchor: DOMRect; student: StudentWire };

type View = 'menu' | 'move' | 'edit' | 'assign' | 'new' | 'confirm-clear' | 'confirm-remove';

function draftFrom(student: StudentWire): StudentDraft {
  return {
    name: student.name,
    courseId: student.courseId,
    cohort: student.cohort,
    studentClass: student.studentClass,
    courseMonth: String(student.courseMonth),
  };
}

/**
 * The editing surface for one cell, one student, or one new record.
 *
 * Everything is a controlled form — the grid is never made `contenteditable`
 * (§21). Each action maps to exactly one API call, and the optimistic
 * apply/rollback lives in useTimetable, so this component only decides what to
 * show and what to call.
 */
export default function CellEditor({
  target,
  store,
  role,
  onClose,
}: {
  target: EditTarget;
  store: ReturnType<typeof useTimetable>;
  role: Role;
  onClose: () => void;
}) {
  const data: TimetableData = store.data;
  const canManageStudents = roleAtLeast(role, 'admin');

  const [view, setView] = useState<View>(
    target.kind === 'entry' ? 'menu'
      : target.kind === 'empty' ? 'assign'
      : target.kind === 'student' ? 'edit'
      : 'new',
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const rangeById = useMemo(
    () => new Map(data.settings.timeRanges.map((r) => [r.id, r])),
    [data.settings.timeRanges],
  );
  const courseById = useMemo(
    () => new Map(data.courses.map((c) => [c.id, c])),
    [data.courses],
  );

  /* ------------------------------------------------------------- context */

  const contextRange =
    target.kind === 'empty'
      ? rangeById.get(target.rangeId)
      : target.kind === 'entry'
        ? data.settings.timeRanges.find(
            (r) => r.startTime === target.schedule.startTime && r.endTime === target.schedule.endTime,
          )
        : undefined;

  const [moveDay, setMoveDay] = useState(
    target.kind === 'entry' ? target.schedule.day : data.settings.days[0] ?? 'Mon',
  );
  const [moveRangeId, setMoveRangeId] = useState(
    contextRange?.id ?? data.settings.timeRanges[0]?.id ?? '',
  );

  const [draft, setDraft] = useState<StudentDraft>(
    target.kind === 'entry'
      ? draftFrom(target.student)
      : target.kind === 'student'
        ? draftFrom(target.student)
        : {
            name: '',
            courseId: data.courses[0]?.id ?? '',
            cohort: null,
            studentClass: null,
            courseMonth: '1',
          },
  );

  /** Students not already booked in this exact cell. */
  const assignable = useMemo(() => {
    if (target.kind !== 'empty') return [];
    const range = rangeById.get(target.rangeId);
    if (!range) return [];
    const taken = new Set(
      data.schedules
        .filter(
          (s) =>
            s.day === target.day &&
            s.startTime === range.startTime &&
            s.endTime === range.endTime,
        )
        .map((s) => s.studentId),
    );
    return data.students
      .filter((s) => !taken.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [target, data.schedules, data.students, rangeById]);

  const [assignId, setAssignId] = useState('');

  /* ------------------------------------------------------------- actions */

  function validateDraft(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!draft.name.trim()) next.name = 'Name is required';
    if (!draft.courseId) next.courseId = 'Pick a course';
    const month = Number(draft.courseMonth);
    if (!Number.isInteger(month) || month < 0) next.courseMonth = 'Whole number of months';
    return next;
  }

  async function run(fn: () => Promise<{ ok: boolean }>): Promise<void> {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    // The store already rolled back and surfaced the reason; just stay open so
    // the user can correct it, rather than closing over a failed change (§25).
    if (result.ok) onClose();
  }

  async function saveStudent(): Promise<void> {
    const found = validateDraft();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const payload = {
      name: draft.name.trim(),
      courseId: draft.courseId,
      cohort: draft.cohort,
      studentClass: draft.studentClass,
      courseMonth: Number(draft.courseMonth),
    };

    const existing =
      target.kind === 'entry' ? target.student : target.kind === 'student' ? target.student : null;

    if (existing) {
      await run(() => store.updateStudent(existing, payload));
      return;
    }

    setBusy(true);
    const created = await store.addStudent(payload);
    if (!created.ok) {
      setBusy(false);
      return;
    }
    // Created from an empty cell: put them straight into it, which is what the
    // click meant. Two calls, but the second only runs if the first succeeded.
    if (target.kind === 'empty') {
      const range = rangeById.get(target.rangeId);
      if (range) {
        await store.assign({
          studentId: created.data.student.id,
          day: target.day,
          startTime: range.startTime,
          endTime: range.endTime,
        });
      }
    }
    setBusy(false);
    onClose();
  }

  /* -------------------------------------------------------------- render */

  const title =
    target.kind === 'entry'
      ? target.student.name
      : target.kind === 'empty'
        ? 'Add to ' + target.day
        : target.kind === 'student'
          ? target.student.name
          : 'New student';

  const subtitle =
    target.kind === 'entry'
      ? `${target.schedule.day} ${target.schedule.startTime}–${target.schedule.endTime}`
      : target.kind === 'empty' && contextRange
        ? `${target.day} ${contextRange.startTime}–${contextRange.endTime}`
        : target.kind === 'student'
          ? courseById.get(target.student.courseId)?.name ?? ''
          : 'Adds to the roster';

  return (
    <Popover anchor={target.anchor} title={title} onClose={onClose}>
      <h5>{title}</h5>
      <p className="pop-sub">{subtitle}</p>

      {view === 'menu' && target.kind === 'entry' && (
        <div className="pop-actions">
          <button type="button" className="btn" onClick={() => setView('move')}>
            <i className="bi bi-arrows-move" aria-hidden="true" /> Move to another time
          </button>
          <button type="button" className="btn" onClick={() => setView('edit')}>
            <i className="bi bi-pencil" aria-hidden="true" /> Edit student details
          </button>
          <div className="pop-divider" />
          <button
            type="button"
            className="btn danger"
            onClick={() => setView('confirm-clear')}
          >
            <i className="bi bi-x-circle" aria-hidden="true" /> Clear this class
          </button>
          {canManageStudents && (
            <button
              type="button"
              className="btn danger"
              onClick={() => setView('confirm-remove')}
            >
              <i className="bi bi-person-dash" aria-hidden="true" /> Remove student…
            </button>
          )}
        </div>
      )}

      {view === 'move' && target.kind === 'entry' && (
        <>
          <div className="field-row two">
            <div>
              <label htmlFor="mv-day">Day</label>
              <select id="mv-day" value={moveDay} onChange={(e) => setMoveDay(e.target.value)}>
                {data.settings.days.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mv-time">Time</label>
              <select
                id="mv-time"
                value={moveRangeId}
                onChange={(e) => setMoveRangeId(e.target.value)}
              >
                {data.settings.timeRanges.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.startTime}–{r.endTime}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="pop-actions row">
            <button type="button" className="btn center" onClick={() => setView('menu')}>
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => {
                const range = rangeById.get(moveRangeId);
                if (!range) return;
                void run(() =>
                  store.moveSchedule(target.schedule, {
                    day: moveDay,
                    startTime: range.startTime,
                    endTime: range.endTime,
                  }),
                );
              }}
            >
              {busy ? 'Moving…' : 'Move'}
            </button>
          </div>
        </>
      )}

      {view === 'assign' && target.kind === 'empty' && (
        <>
          <div className="field-row">
            <label htmlFor="as-student">Student</label>
            <select
              id="as-student"
              value={assignId}
              onChange={(e) => setAssignId(e.target.value)}
            >
              <option value="">Choose…</option>
              {assignable.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="pop-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !assignId}
              onClick={() => {
                const range = rangeById.get(target.rangeId);
                if (!range) return;
                void run(() =>
                  store.assign({
                    studentId: assignId,
                    day: target.day,
                    startTime: range.startTime,
                    endTime: range.endTime,
                  }),
                );
              }}
            >
              {busy ? 'Adding…' : 'Add to this class'}
            </button>
            <div className="pop-divider" />
            <button type="button" className="btn" onClick={() => setView('new')}>
              <i className="bi bi-person-plus" aria-hidden="true" /> New student…
            </button>
          </div>
        </>
      )}

      {(view === 'edit' || view === 'new') && (
        <>
          <StudentFields
            draft={draft}
            courses={data.courses}
            errors={errors}
            onChange={setDraft}
          />
          <div className="pop-actions row">
            <button
              type="button"
              className="btn center"
              onClick={() => (target.kind === 'entry' ? setView('menu') : onClose())}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void saveStudent()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}

      {/* Destructive actions state what will happen, in the words of the thing
          being destroyed, before they happen (§45). */}
      {view === 'confirm-clear' && target.kind === 'entry' && (
        <div className="pop-confirm">
          <p>
            Clear <strong>{target.student.name}</strong> from {target.schedule.day}{' '}
            {target.schedule.startTime}–{target.schedule.endTime}? They stay on the roster and
            keep their other classes.
          </p>
          <div className="pop-actions row">
            <button type="button" className="btn center" onClick={() => setView('menu')}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger center"
              disabled={busy}
              onClick={() => void run(() => store.clearSchedule(target.schedule))}
            >
              {busy ? 'Clearing…' : 'Clear class'}
            </button>
          </div>
        </div>
      )}

      {view === 'confirm-remove' && target.kind === 'entry' && (
        <div className="pop-confirm">
          <p>
            Remove <strong>{target.student.name}</strong> from the academy? This also removes
            their{' '}
            {data.schedules.filter((s) => s.studentId === target.student.id).length} class
            assignment(s).
          </p>
          <div className="pop-actions row">
            <button type="button" className="btn center" onClick={() => setView('menu')}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger center"
              disabled={busy}
              onClick={() => void run(() => store.removeStudent(target.student))}
            >
              {busy ? 'Removing…' : 'Remove student'}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
