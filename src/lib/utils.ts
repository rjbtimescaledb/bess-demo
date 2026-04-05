export function formatPower(mw: number | null | undefined): string {
  if (mw == null) return '-- MW';
  return `${Math.abs(mw).toFixed(1)} MW`;
}

export function formatEnergy(mwh: number | null | undefined): string {
  if (mwh == null) return '-- MWh';
  return `${mwh.toFixed(1)} MWh`;
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct == null) return '--%';
  return `${pct.toFixed(1)}%`;
}

export function formatTemp(c: number | null | undefined): string {
  if (c == null) return '-- °C';
  return `${c.toFixed(1)} °C`;
}

export function formatCurrency(usd: number | null | undefined): string {
  if (usd == null) return '$--';
  return `$${usd.toFixed(2)}`;
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'emergency': return 'badge-emergency';
    case 'critical': return 'badge-critical';
    case 'warning': return 'badge-warning';
    case 'info': return 'badge-info';
    default: return 'badge-info';
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'online':
    case 'operational':
    case 'available':
    case 'completed':
      return 'badge-online';
    case 'offline':
    case 'maintenance':
    case 'degraded':
      return 'badge-offline';
    default:
      return 'badge-info';
  }
}

export function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
