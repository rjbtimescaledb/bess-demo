import { NextRequest, NextResponse } from 'next/server';
import { getMaintenanceLogs } from '@/lib/queries';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const { data, queryMs } = await getMaintenanceLogs(
      sp.get('siteId') || undefined,
      sp.get('limit') ? parseInt(sp.get('limit')!) : undefined,
    );
    return NextResponse.json({ data, meta: { queryMs } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
