import { Button } from "./button";

export interface Paged<T> {
  rows: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(rows: T[], page: number, size: number): Paged<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages - 1);
  return { rows: rows.slice(p * size, p * size + size), page: p, pages, total: rows.length };
}

export function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (p: number) => void }) {
  const from = total ? page * size + 1 : 0;
  const to = Math.min(total, (page + 1) * size);
  return (
    <div className="flex items-center justify-between gap-[10px] text-[13px] text-neutral-700">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-[6px]">
        <span>
          Page {page + 1} of {pages}
        </span>
        <Button iconOnly icon="chevL" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))} />
        <Button iconOnly icon="chevR" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(Math.min(pages - 1, page + 1))} />
      </div>
    </div>
  );
}
