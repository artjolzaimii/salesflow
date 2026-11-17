/**
 * Marks a screen that still runs on fictional preview data (its backend phase
 * is not done yet), so preview records are never mistaken for real ones.
 */
export function PreviewNotice({ module }: { module: string }) {
  return (
    <div role="note" className="flex flex-wrap items-center gap-[10px] border border-divider px-[14px] py-[8px] text-[12.5px] text-neutral-800">
      <span className="tag bg-warning-100 text-warning-800">Preview data</span>
      <span>
        {module} still use fictional sample records. They are not your business data and changes are not saved.
      </span>
    </div>
  );
}
