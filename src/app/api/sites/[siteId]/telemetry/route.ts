import { NextRequest, NextResponse } from 'next/server';
import { getTelemetryHistory } from '@/lib/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const sp = req.nextUrl.searchParams;
    const { data, queryMs, table } = await getTelemetryHistory(
      siteId,
      sp.get('from') || undefined,
      sp.get('to') || undefined,
      sp.get('resolution') || undefined,
    );
    return NextResponse.json({ data, meta: { queryMs, table, count: data.length } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
