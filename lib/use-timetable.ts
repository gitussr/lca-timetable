'use client';

import { useCallback, useRef, useState } from 'react';
import { api, describe, type ApiResult } from './api-client';
import type { TimetableData } from './timetable-data';
import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from './serialize';
import type { TimeRange } from './types';

/**
 * Timetable state and every mutation that touches it.
 *
 * Optimistic by design (§25): the change lands in local state first so the grid
 * responds instantly, then the server is asked. If the server refuses — a role
 * check, a validation error, or somebody else's edit winning a version race —
 * the snapshot is restored and the reason is shown. The browser is never left
 * displaying something that was not saved.
 *
 * Kept out of the components on purpose (§33): the grid renders, this decides.
 */

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

/**
 * Folds a server-confirmed insert into a list.
 *
 * The optimistic row, if there was one, is dropped and the real document
 * upserted by id — never mapped temp -> real in place. The realtime echo of our
 * own insert can arrive BEFORE the HTTP response that created it, in which case
 * the echo has already appended the real document; mapping would then leave it
 * in the list twice, under the same id.
 *
 * That is exactly what happened on 2026-09-11: a student created in one browser
 * appeared twice in that browser and once in every other. Only the author of an
 * edit can hit it, and only when the stream beats the response, which is why it
 * looked intermittent.
 */
function commitInsert<T extends { id: string }>(list: T[], doc: T, tempId?: string): T[] {
  const rest = tempId ? list.filter((x) => x.id !== tempId) : list;
  return rest.some((x) => x.id === doc.id)
    ? rest.map((x) => (x.id === doc.id ? doc : x))
    : [...rest, doc];
}

export function useTimetable(initial: TimetableData) {
  const [data, setData] = useState<TimetableData>(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = useCallback(() => {
    setSave({ kind: 'saved' });
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSave({ kind: 'idle' }), 1600);
  }, []);

  /** Re-reads everything. Used after a conflict, so the UI resyncs wholesale. */
  const refresh = useCallback(async () => {
    const res = await api.get<TimetableData>('/api/bootstrap');
    if (res.ok) setData(res.data);
  }, []);

  /**
   * Applies `optimistic` immediately, runs `call`, and either commits the
   * server's answer or rolls the whole thing back.
   */
  const mutate = useCallback(
    async <T,>(
      optimistic: (d: TimetableData) => TimetableData,
      call: () => Promise<ApiResult<T>>,
      commit?: (d: TimetableData, result: T) => TimetableData,
    ): Promise<ApiResult<T>> => {
      let snapshot: TimetableData | null = null;
      setData((current) => {
        snapshot = current;
        return optimistic(current);
      });

      setSave({ kind: 'saving' });
      const result = await call();

      if (result.ok) {
        if (commit) setData((current) => commit(current, result.data));
        flashSaved();
        return result;
      }

      // Roll back to exactly what was on screen before (§25).
      if (snapshot) setData(snapshot);
      setSave({ kind: 'error', message: describe(result) });

      // Somebody else won the race — take their version rather than ours (§24).
      if (result.status === 409) void refresh();

      return result;
    },
    [flashSaved, refresh],
  );

  /* ------------------------------------------------------------ students */

  const addStudent = useCallback(
    (input: {
      name: string;
      courseId: string;
      cohort: string | null;
      studentClass: string | null;
      courseMonth: number;
    }) => {
      // A placeholder id, replaced by the server's on commit.
      const tempId = 'temp-' + Math.random().toString(36).slice(2);
      const optimisticStudent: StudentWire = {
        id: tempId,
        name: input.name,
        courseId: input.courseId,
        cohort: input.cohort,
        studentClass: input.studentClass,
        courseMonth: input.courseMonth,
        active: true,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        version: 0,
      };
      return mutate<{ student: StudentWire }>(
        (d) => ({ ...d, students: [...d.students, optimisticStudent] }),
        () => api.post('/api/students', input),
        (d, r) => ({
          ...d,
          students: commitInsert(d.students, r.student, tempId),
        }),
      );
    },
    [mutate],
  );

  const updateStudent = useCallback(
    (student: StudentWire, changes: Partial<StudentWire>) =>
      mutate<{ student: StudentWire }>(
        (d) => ({
          ...d,
          students: d.students.map((s) => (s.id === student.id ? { ...s, ...changes } : s)),
        }),
        () => api.patch('/api/students/' + student.id, { ...changes, version: student.version }),
        (d, r) => ({
          ...d,
          students: d.students.map((s) => (s.id === r.student.id ? r.student : s)),
        }),
      ),
    [mutate],
  );

  /** Removes the person AND their classes — distinct from clearing one (§22). */
  const removeStudent = useCallback(
    (student: StudentWire) =>
      mutate<{ ok: boolean }>(
        (d) => ({
          ...d,
          students: d.students.filter((s) => s.id !== student.id),
          schedules: d.schedules.filter((s) => s.studentId !== student.id),
        }),
        () => api.del('/api/students/' + student.id),
      ),
    [mutate],
  );

  /* ----------------------------------------------------------- schedules */

  const assign = useCallback(
    (input: { studentId: string; day: string; startTime: string; endTime: string }) => {
      const tempId = 'temp-' + Math.random().toString(36).slice(2);
      const optimisticSchedule: ScheduleWire = {
        id: tempId,
        studentId: input.studentId,
        day: input.day,
        startTime: input.startTime,
        endTime: input.endTime,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        version: 0,
      };
      return mutate<{ schedule: ScheduleWire }>(
        (d) => ({ ...d, schedules: [...d.schedules, optimisticSchedule] }),
        () => api.post('/api/schedules', input),
        (d, r) => ({
          ...d,
          schedules: commitInsert(d.schedules, r.schedule, tempId),
        }),
      );
    },
    [mutate],
  );

  const moveSchedule = useCallback(
    (schedule: ScheduleWire, to: { day: string; startTime: string; endTime: string }) =>
      mutate<{ schedule: ScheduleWire }>(
        (d) => ({
          ...d,
          schedules: d.schedules.map((s) => (s.id === schedule.id ? { ...s, ...to } : s)),
        }),
        () => api.patch('/api/schedules/' + schedule.id, { ...to, version: schedule.version }),
        (d, r) => ({
          ...d,
          schedules: d.schedules.map((s) => (s.id === r.schedule.id ? r.schedule : s)),
        }),
      ),
    [mutate],
  );

  /** CLEARS one assignment. The student stays on the roster (§22). */
  const clearSchedule = useCallback(
    (schedule: ScheduleWire) =>
      mutate<{ ok: boolean }>(
        (d) => ({ ...d, schedules: d.schedules.filter((s) => s.id !== schedule.id) }),
        () => api.del('/api/schedules/' + schedule.id),
      ),
    [mutate],
  );

  /* ------------------------------------------------------------ settings */

  /**
   * Settings changes (§40). `timeRanges` is what removes the four-column limit:
   * the grid renders whatever this array says, so adding a column is data, not
   * a deploy.
   *
   * The server refuses to drop a range that still has classes in it and says
   * how many — that 409 reaches the user verbatim rather than as a rollback
   * with no explanation.
   */
  const updateSettings = useCallback(
    (changes: Partial<Omit<SettingsWire, 'version'>>) =>
      mutate<{ settings: SettingsWire }>(
        (d) => ({ ...d, settings: { ...d.settings, ...changes } }),
        () => api.patch('/api/settings', { ...changes, version: data.settings.version }),
        (d, r) => ({ ...d, settings: r.settings }),
      ),
    [mutate, data.settings.version],
  );

  /** Renumbers `order` so it always matches array position. */
  const setTimeRanges = useCallback(
    (ranges: TimeRange[]) =>
      updateSettings({ timeRanges: ranges.map((r, i) => ({ ...r, order: i })) }),
    [updateSettings],
  );

  /* ------------------------------------------------------------- courses */

  const updateCourse = useCallback(
    (course: CourseWire, changes: Partial<CourseWire>) =>
      mutate<{ course: CourseWire }>(
        (d) => ({
          ...d,
          courses: d.courses.map((c) => (c.id === course.id ? { ...c, ...changes } : c)),
        }),
        () => api.patch('/api/courses/' + course.id, { ...changes, version: course.version }),
        (d, r) => ({
          ...d,
          courses: d.courses.map((c) => (c.id === r.course.id ? r.course : c)),
        }),
      ),
    [mutate],
  );

  const addCourse = useCallback(
    (input: {
      name: string;
      shortName: string | null;
      defaultDuration: number;
      sessionsPerWeek: number;
      icon: string;
      order: number;
    }) =>
      mutate<{ course: CourseWire }>(
        (d) => d, // no optimistic row: the id comes from the server
        () => api.post('/api/courses', input),
        (d, r) => ({ ...d, courses: commitInsert(d.courses, r.course) }),
      ),
    [mutate],
  );

  const removeCourse = useCallback(
    (course: CourseWire) =>
      mutate<{ ok: boolean }>(
        (d) => ({ ...d, courses: d.courses.filter((c) => c.id !== course.id) }),
        () => api.del('/api/courses/' + course.id),
      ),
    [mutate],
  );

  /**
   * Folds a change that came from ANOTHER browser into local state (§23).
   *
   * Separate from `mutate` on purpose: this is not our write, so it must not
   * touch the save indicator, must not roll anything back, and must not be
   * sent anywhere. It is the server telling us what is now true.
   */
  const applyRemote = useCallback(
    (apply: (d: TimetableData) => TimetableData) => setData((current) => apply(current)),
    [],
  );

  const dismissError = useCallback(() => setSave({ kind: 'idle' }), []);

  return {
    data,
    setData,
    save,
    dismissError,
    refresh,
    addStudent,
    updateStudent,
    removeStudent,
    assign,
    moveSchedule,
    clearSchedule,
    updateSettings,
    setTimeRanges,
    updateCourse,
    addCourse,
    removeCourse,
    applyRemote,
  };
}
