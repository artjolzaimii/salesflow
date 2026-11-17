/**
 * Client-side validation, mirrored from the prototype. The server validates again;
 * these checks only give immediate feedback.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- login ---------- */

export interface LoginForm {
  email: string;
  password: string;
}

export function validateLogin(f: LoginForm): FieldErrors<keyof LoginForm> {
  const e: FieldErrors<keyof LoginForm> = {};
  if (!EMAIL.test(f.email.trim())) e.email = "Enter your work email.";
  if (f.password.length < 8) e.password = "Password must be at least 8 characters.";
  return e;
}
