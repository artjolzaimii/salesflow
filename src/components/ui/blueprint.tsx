import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/** The four "+" registration marks every Industry frame wears. */
export function Corners() {
  return (
    <>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </>
  );
}

type BlueprintProps<T extends ElementType> = {
  as?: T;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

/** A square, hairline-bordered frame with corner marks (`.blueprint`). */
export function Blueprint<T extends ElementType = "div">({ as, children, className = "", ...rest }: BlueprintProps<T>) {
  const Tag = (as || "div") as ElementType;
  return (
    <Tag className={`blueprint ${className}`} {...rest}>
      <Corners />
      {children}
    </Tag>
  );
}

/** Standard content panel: blueprint frame, 16×18 padding, vertical stack. */
export function Panel({
  as = "section",
  className = "",
  children,
  ...rest
}: { as?: "section" | "div" | "aside"; className?: string; children?: ReactNode } & Omit<ComponentPropsWithoutRef<"section">, "className" | "children">) {
  return (
    <Blueprint as={as} className={`flex min-w-0 flex-col px-[18px] py-4 ${className}`} {...rest}>
      {children}
    </Blueprint>
  );
}

export function PanelHeader({ title, note, as = "h3" }: { title: ReactNode; note?: ReactNode; as?: "h3" | "h4" }) {
  const H = as;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <H className={as === "h3" ? "panel-title" : "m-0 text-[16px]"}>{title}</H>
      {note ? <span className="panel-note">{note}</span> : null}
    </div>
  );
}
