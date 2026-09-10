'use client';

import { useState } from 'react';
import type { CourseWire, StudentWire } from '@/lib/serialize';
import { buildRoster } from '@/lib/timetable-view';
import type { EditTarget } from './cell-editor';

/**
 * The footer roster (§19).
 *
 * Rendered from the SAME `students` array the grid uses — the single most
 * important structural change in the migration. The legacy page kept two
 * hand-synchronised copies of every student, one in the grid and one here, and
 * nothing but diligence kept them in step (§6.2, §20).
 *
 * Sections are derived from course + cohort rather than hard-coded headings
 * (decision D1), so a new cohort appears without a code change.
 */
export default function RosterFooter({
  students,
  courses,
  editing,
  onPick,
}: {
  students: StudentWire[];
  courses: CourseWire[];
  editing: boolean;
  onPick: (target: EditTarget) => void;
}) {
  const sections = buildRoster(students, courses);
  // The legacy accordion opened one section at a time; null means all closed.
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <footer>
      {sections.map((section) => {
        const isOpen = openKey === section.key;
        return (
          <div
            className={isOpen ? 'toggle-section active' : 'toggle-section'}
            data-toggle-id={section.key}
            key={section.key}
          >
            <summary
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => setOpenKey(isOpen ? null : section.key)}
              onKeyDown={(e) => {
                // The legacy <summary> was mouse-only; keyboard users could not
                // open the roster at all (§46).
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenKey(isOpen ? null : section.key);
                }
              }}
            >
              {section.label}
            </summary>
            <div className="toggle-content">
              <ul>
                {section.students.map((student) => (
                  <li
                    key={student.id}
                    data-d="d"
                    {...(editing
                      ? {
                          role: 'button' as const,
                          tabIndex: 0,
                          'aria-label': `Edit ${student.name}`,
                          onClick: (e: React.MouseEvent<HTMLLIElement>) =>
                            onPick({
                              kind: 'student',
                              anchor: e.currentTarget.getBoundingClientRect(),
                              student,
                            }),
                          onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            onPick({
                              kind: 'student',
                              anchor: e.currentTarget.getBoundingClientRect(),
                              student,
                            });
                          },
                        }
                      : {})}
                  >
                    {student.name}
                    {student.studentClass ? `(std.${student.studentClass})` : ''}{' '}
                    {/* Zero-padded for display only; stored as a number (§12). */}
                    ({String(student.courseMonth).padStart(2, '0')})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </footer>
  );
}
