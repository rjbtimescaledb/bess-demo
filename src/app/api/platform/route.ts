import { NextResponse } from 'next/server';
import { getPlatformStats } from '@/lib/queries';

export async function GET() {
  try {
    const { data, queryMs } = await getPlatformStats();
    return NextResponse.json({ data, meta: { queryMs } });
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 500 });
  }
}
