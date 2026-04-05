import { NextRequest, NextResponse } from 'next/server';
import { getActiveAlarms, getAlarmHistory } from '@/lib/queries';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const siteId = sp.get('siteId') || undefined;
    const active = sp.get('active') === 'true';

    if (active) {
      const { data, queryMs } = await getActiveAlarms(siteId);
      return NextResponse.json({ data, meta: { queryMs } });
    }

    const { data, queryMs } = await getAlarmHistory(siteId, sp.get('from') || undefined, sp.get('to') || undefined);
    return NextResponse.json({ data, meta: { queryMs } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
