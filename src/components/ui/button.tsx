import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Corners } from "./blueprint";
import { Icon, type IconName } from "./icon";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Square 36px icon button. */
  iconOnly?: boolean;
  icon?: IconName;
  children?: ReactNode;
}

/**
 * Industry `.btn`. Primary buttons are the one solid object on the board and
 * always wear the blueprint frame with registration marks.
 */
export function Button({ variant = "secondary", iconOnly, icon, className = "", children, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, iconOnly ? "btn-icon" : "", variant === "primary" ? "blueprint" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {variant === "primary" ? <Corners /> : null}
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
