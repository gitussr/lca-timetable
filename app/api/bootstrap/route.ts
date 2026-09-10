import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/rbac';
import { loadTimetableData } from '@/lib/timetable-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the timetable needs, in one round trip (§47) — the same loader the
 * page's server render uses, so the initial paint and every later refresh can
 * never disagree about the data.
 */
export const GET = withAuth(async () => {
  const data = await loadTimetableData();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
});
