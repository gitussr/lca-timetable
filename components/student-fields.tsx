'use client';

import type { CourseWire } from '@/lib/serialize';
import { COHORTS } from '@/lib/constants';

export interface StudentDraft {
  name: string;
  courseId: string;
  cohort: string | null;
  studentClass: string | null;
  courseMonth: string;
}

/**
 * The student fields, shared by "add" and "edit" so the two cannot drift.
 *
 * `courseMonth` is a text input rather than a number spinner because it is a
 * running course month, not a quantity anyone increments one at a time (§12).
 * Its label says so — the legacy page showed a bare number beside each name,
 * which is exactly why it kept being mistaken for an ID.
 */
export default function StudentFields({
  draft,
  courses,
  errors,
  onChange,
}: {
  draft: StudentDraft;
  courses: CourseWire[];
  errors: Record<string, string>;
  onChange: (next: StudentDraft) => void;
}) {
  const set = <K extends keyof StudentDraft>(key: K, value: StudentDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      <div className="field-row">
        <label htmlFor="sf-name">Name</label>
        <input
          id="sf-name"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'sf-name-err' : undefined}
          autoComplete="off"
        />
        {errors.name && (
          <p className="field-error" id="sf-name-err">
            {errors.name}
          </p>
        )}
      </div>

      <div className="field-row">
        <label htmlFor="sf-course">Course</label>
        <select
          id="sf-course"
          value={draft.courseId}
          onChange={(e) => set('courseId', e.target.value)}
          aria-invalid={Boolean(errors.courseId)}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.courseId && <p className="field-error">{errors.courseId}</p>}
      </div>

      <div className="field-row two">
        <div>
          <label htmlFor="sf-cohort">Cohort</label>
          <select
            id="sf-cohort"
            value={draft.cohort ?? ''}
            onChange={(e) => set('cohort', e.target.value || null)}
          >
            <option value="">None</option>
            {COHORTS.map((c) => (
              <option key={c} value={c}>
                {c === 'old' ? 'Old' : 'New'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sf-class">Std.</label>
          <input
            id="sf-class"
            value={draft.studentClass ?? ''}
            onChange={(e) => set('studentClass', e.target.value || null)}
            placeholder="8"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="field-row">
        <label htmlFor="sf-month">Course month</label>
        <input
          id="sf-month"
          inputMode="numeric"
          value={draft.courseMonth}
          onChange={(e) => set('courseMonth', e.target.value)}
          aria-invalid={Boolean(errors.courseMonth)}
          aria-describedby="sf-month-help"
          autoComplete="off"
        />
        <p className="field-error" id="sf-month-help" style={{ color: 'var(--text-dim)' }}>
          {errors.courseMonth ?? 'Months running, not an ID.'}
        </p>
      </div>
    </>
  );
}
