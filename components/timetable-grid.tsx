'use client';

import type { CSSProperties } from 'react';
import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from '@/lib/serialize';
import { buildGrid, findNow } from '@/lib/timetable-view';
import type { EditTarget } from './cell-editor';

/**
 * The timetable grid (§4, §6). A node-for-node port of the legacy
 * `<section class="timetable">` against the same class names, so globals.css
 * applies unchanged — but every cell now comes from the database (§4).
 *
 * Two hard-coded limits are gone:
 *   - the four columns, which lived in the CSS, in five header divs, and in
 *     script.js's index arithmetic. Columns now come from settings.timeRanges,
 *     and the count reaches the CSS through --slot-cols (§15, §40).
 *   - the five <li> per cell, which are now settings.slotCapacity. The empty
 *     ones are still rendered: they are what reserves the row height, and
 *     removing them would collapse short cells.
 *
 * In edit mode the same <li> elements become buttons. Nothing is
 * contenteditable (§21) — a click opens a controlled form.
 */
export default function TimetableGrid({
  settings,
  students,
  schedules,
  courses,
  now,
  editing,
  onPick,
}: {
  settings: SettingsWire;
  students: StudentWire[];
  schedules: ScheduleWire[];
  courses: CourseWire[];
  now: Date | null;
  editing: boolean;
  onPick: (target: EditTarget) => void;
}) {
  const { cells } = buildGrid(settings, students, schedules, courses);
  const { today, liveRangeIds } = now
    ? findNow(settings, now)
    : { today: null, liveRangeIds: [] as string[] };
  // Overlapping ranges mean more than one column can be live at once.
  const live = new Set(liveRangeIds);

  // Drives the CSS grid at every breakpoint without touching the media queries.
  const gridVars = {
    '--slot-cols': settings.timeRanges.length,
    '--day-rows': settings.days.length,
  } as CSSProperties;

  if (settings.timeRanges.length === 0) {
    return (
      <section className="timetable" style={gridVars}>
        <div className="header-row">Days</div>
      </section>
    );
  }

  return (
    <section className="timetable" style={gridVars}>
      <div className="header-row">Days</div>
      {settings.timeRanges.map((range) => (
        <div className="header-row" key={range.id}>
          <span className="slot-time">{range.startTime}</span>
          <span className="slot-sep">–</span>
          <span className="slot-time">{range.endTime}</span>
        </div>
      ))}

      {settings.days.map((day) => (
        <Row
          key={day}
          day={day}
          isToday={day === today}
          settings={settings}
          cells={cells}
          live={live}
          editing={editing}
          onPick={onPick}
        />
      ))}
    </section>
  );
}

function Row({
  day,
  isToday,
  settings,
  cells,
  live,
  editing,
  onPick,
}: {
  day: string;
  isToday: boolean;
  settings: SettingsWire;
  cells: ReturnType<typeof buildGrid>['cells'];
  live: Set<string>;
  editing: boolean;
  onPick: (target: EditTarget) => void;
}) {
  return (
    <>
      <div className={isToday ? 'day is-today' : 'day'}>{day}</div>
      {settings.timeRanges.map((range) => {
        const cell = cells.get(day + '|' + range.id);
        const entries = cell?.entries ?? [];

        const classes = ['slot'];
        if (isToday) classes.push('is-today-col');
        if (isToday && live.has(range.id)) classes.push('is-live');

        // Pad to capacity so every row keeps its share of the cell height,
        // exactly as the legacy empty <li> elements did.
        const padding = Math.max(0, settings.slotCapacity - entries.length);

        return (
          <div className={classes.join(' ')} key={range.id}>
            <ul>
              {entries.map(({ schedule, student, icon }) => (
                <li
                  key={schedule.id}
                  className={icon}
                  title={student.name}
                  {...(editing
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `Edit ${student.name}, ${day} ${range.startTime} to ${range.endTime}`,
                        onClick: (e: React.MouseEvent<HTMLLIElement>) =>
                          onPick({
                            kind: 'entry',
                            anchor: e.currentTarget.getBoundingClientRect(),
                            schedule,
                            student,
                          }),
                        onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          onPick({
                            kind: 'entry',
                            anchor: e.currentTarget.getBoundingClientRect(),
                            schedule,
                            student,
                          });
                        },
                      }
                    : {})}
                >
                  {student.name}
                </li>
              ))}
              {Array.from({ length: padding }, (_, i) => (
                <li
                  key={'pad-' + i}
                  {...(editing
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `Add a student to ${day} ${range.startTime} to ${range.endTime}`,
                        onClick: (e: React.MouseEvent<HTMLLIElement>) =>
                          onPick({
                            kind: 'empty',
                            anchor: e.currentTarget.getBoundingClientRect(),
                            day,
                            rangeId: range.id,
                          }),
                        onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          onPick({
                            kind: 'empty',
                            anchor: e.currentTarget.getBoundingClientRect(),
                            day,
                            rangeId: range.id,
                          });
                        },
                      }
                    : {})}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
