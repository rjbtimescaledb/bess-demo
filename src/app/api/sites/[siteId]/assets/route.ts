import { NextRequest, NextResponse } from 'next/server';
import { getSiteAssets } from '@/lib/queries';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const { data, queryMs } = await getSiteAssets(siteId);
    return NextResponse.json({ data, meta: { queryMs } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
