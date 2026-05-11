import { NextRequest, NextResponse } from 'next/server';
import { getSohTrend } from '@/lib/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const days = parseInt(req.nextUrl.searchParams.get('days') || '30');
    const { data, queryMs } = await getSohTrend(siteId, days);
    return NextResponse.json({ data, meta: { queryMs, days } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
