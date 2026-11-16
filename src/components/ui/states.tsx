import type { ReactNode } from "react";
import { Blueprint } from "./blueprint";
import { Button } from "./button";
import { Icon } from "./icon";

const SKELETON_WIDTHS = ["92%", "74%", "86%", "61%", "89%", "70%"];

/** Placeholder bars shown while a list loads. */
export function SkeletonRows() {
  return (
    <div className="flex flex-col gap-[14px] py-[10px]" aria-busy="true" aria-label="Loading">
      {SKELETON_WIDTHS.map((w) => (
        <div key={w} className="h-[14px] bg-neutral-200" style={{ width: w }} />
      ))}
    </div>
  );
}

export function SkeletonCards() {
  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]" aria-busy="true" aria-label="Loading">
      {SKELETON_WIDTHS.slice(0, 4).map((w) => (
        <Blueprint key={w} className="flex h-[112px] flex-col gap-3 p-4">
          <div className="h-[10px] w-[40%] bg-neutral-200" />
          <div className="h-[26px] bg-neutral-200" style={{ width: w }} />
        </Blueprint>
      ))}
    </div>
  );
}

export function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-[10px] py-7 text-center">
      <span className="text-danger-700">
        <Icon name="alert" />
      </span>
      <div>{message}</div>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function ListEmpty({ title, body, onClear, clearLabel = "Clear filters" }: { title: string; body: string; onClear?: () => void; clearLabel?: string }) {
  return (
    <div className="flex flex-col items-center gap-[6px] py-9 text-center">
      <h4 className="m-0">{title}</h4>
      <p className="text-muted m-0 text-[13px]">{body}</p>
      {onClear ? (
        <Button variant="ghost" onClick={onClear}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Form-level error banner (validation summary). */
export function AlertBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-center gap-[10px] border border-danger-300 bg-danger-50 px-[14px] py-[10px] text-[13px] text-danger-900">
      <Icon name="alert" />
      {children}
    </div>
  );
}

/** Generic "nothing here" line inside a panel. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-muted m-0 py-5 text-center">{children}</p>;
}
