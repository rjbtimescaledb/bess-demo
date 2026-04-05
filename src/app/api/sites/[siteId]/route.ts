import { NextRequest, NextResponse } from 'next/server';
import { getSiteDetail, getLatestTelemetry, getSiteKPIs } from '@/lib/queries';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const [site, telemetry, kpis] = await Promise.all([
      getSiteDetail(siteId),
      getLatestTelemetry(siteId),
      getSiteKPIs(siteId),
    ]);
    const queryMs = site.queryMs + telemetry.queryMs + kpis.queryMs;
    return NextResponse.json({
      data: { site: site.data, telemetry: telemetry.data, kpis: kpis.data },
      meta: { queryMs },
    });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
