export function QueryTimer({ queryMs }: { queryMs: number }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-xs font-mono text-slate-500">
      {queryMs}ms
    </span>
  );
}
