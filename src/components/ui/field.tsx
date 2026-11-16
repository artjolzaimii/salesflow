import type { ReactNode } from "react";

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Industry `.field`: small muted label, control, optional hint and error. */
export function Field({ label, htmlFor, error, hint, className = "", children }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <label>{label}</label>}
      {children}
      {hint ? <div className="mt-1 text-[12px] text-neutral-700">{hint}</div> : null}
      {error ? (
        <div className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Props that wire a control to its Field error for assistive tech. */
export function invalidProps(id: string, error?: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

interface Option {
  value: string;
  label: string;
}

/** `.seg` segmented radio group on native inputs. */
export function Segmented({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className="seg-opt">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function SelectOptions({ options }: { options: (string | Option)[] }) {
  return (
    <>
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </>
  );
}
