import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/viewer';
import { loadTimetableData } from '@/lib/timetable-data';
import TimetableApp from '@/components/timetable-app';

export const runtime = 'nodejs';
/** Live data — never statically cached (§47). */
export const dynamic = 'force-dynamic';

/**
 * The timetable is the primary screen (§38): login goes straight here, with no
 * dashboard in between.
 *
 * proxy.ts already redirects signed-out visitors, but this check is the real
 * one — proxy is a convenience, never the authorization boundary (§8).
 */
export default async function Page() {
  // Shared with the layout through React's cache, so this costs one read.
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const data = await loadTimetableData();

  return (
    <TimetableApp
      initial={data}
      preferredTheme={viewer.preferredTheme}
      role={viewer.role}
      userId={viewer.id}
    />
  );
}
