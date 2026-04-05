import { NextResponse } from 'next/server';
import { getFleetOverview, getFleetKPIs } from '@/lib/queries';

export async function GET() {
  try {
    const [overview, kpis] = await Promise.all([getFleetOverview(), getFleetKPIs()]);
    return NextResponse.json({
      data: { sites: overview.data, kpis: kpis.data },
      meta: { queryMs: overview.queryMs + kpis.queryMs },
    });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
