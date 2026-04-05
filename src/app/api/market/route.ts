import { NextRequest, NextResponse } from 'next/server';
import { getMarketPrices } from '@/lib/queries';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const { data, queryMs } = await getMarketPrices(
      sp.get('market') || undefined,
      sp.get('from') || undefined,
      sp.get('to') || undefined,
    );
    return NextResponse.json({ data, meta: { queryMs } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
