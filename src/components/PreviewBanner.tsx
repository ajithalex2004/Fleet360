/**
 * Marks a screen whose figures are built-in examples, not the tenant's
 * records, so nobody mistakes them for live data in a demo. Remove it from
 * a screen once that screen reads from the API.
 */
export default function PreviewBanner({ note }: { note?: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
    >
      <span className="mt-0.5 rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
        Preview
      </span>
      <p>
        <strong className="font-semibold">Sample data.</strong>{' '}
        {note ?? 'This screen shows example figures, not your records. It is not yet connected to your data.'}
      </p>
    </div>
  );
}
