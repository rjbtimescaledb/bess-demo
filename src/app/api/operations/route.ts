import { NextRequest, NextResponse } from 'next/server';
import { getDispatchReadiness, getRevenueOpportunityNow, getMissedRevenue, getDispatchMarketCorrelation, getAssetHealthTimeline, getExecutiveSummary, getAssetHealthDegradation, getFleetUtilization } from '@/lib/queries';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const view = sp.get('view') || 'summary';

    switch (view) {
      case 'dispatch-readiness': {
        const { data, queryMs } = await getDispatchReadiness();
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'revenue-now': {
        const { data, queryMs } = await getRevenueOpportunityNow();
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'missed-revenue': {
        const { data, queryMs } = await getMissedRevenue(
          sp.get('from') || undefined,
          sp.get('to') || undefined,
        );
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'dispatch-correlation': {
        const { data, queryMs } = await getDispatchMarketCorrelation(
          sp.get('siteId') || undefined,
          sp.get('from') || undefined,
          sp.get('to') || undefined,
        );
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'asset-health': {
        const siteId = sp.get('siteId');
        if (!siteId) return NextResponse.json({ data: null, error: 'siteId required' }, { status: 400 });
        const { data, queryMs } = await getAssetHealthTimeline(siteId);
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'asset-health-degradation': {
        const { data, queryMs } = await getAssetHealthDegradation();
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'fleet-utilization': {
        const { data, queryMs } = await getFleetUtilization();
        return NextResponse.json({ data, meta: { queryMs } });
      }
      case 'summary':
      default: {
        const { data, queryMs } = await getExecutiveSummary();
        return NextResponse.json({ data, meta: { queryMs } });
      }
    }
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
