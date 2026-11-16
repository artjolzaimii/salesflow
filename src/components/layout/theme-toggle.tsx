"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/*
 * The theme lives on <html data-theme>, set before first paint by the inline
 * script in src/app/layout.tsx. This component only reads and flips it.
 * With no stored choice the app follows the OS setting, including live changes.
 */

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (storedTheme()) return;
    document.documentElement.dataset.theme = media.matches ? "dark" : "light";
    notify();
  };
  media.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
  };
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

const getSnapshot = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const getServerSnapshot = (): Theme | null => null;

function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage blocked: the switch still applies for this page view.
  }
  notify();
}

function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return { theme, next, toggle: () => setTheme(next) };
}

/** Topbar icon button (hidden below the nav breakpoint, where space is tight). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, next, toggle } = useTheme();
  return (
    <Button
      iconOnly
      icon={theme === "dark" ? "sun" : "moon"}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={className}
      onClick={toggle}
    />
  );
}

/** Row for the account menu, so the switch is reachable on mobile too. */
export function ThemeMenuItem({ className = "" }: { className?: string }) {
  const { theme, next, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} className={className}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
      {next === "dark" ? "Dark mode" : "Light mode"}
    </button>
  );
}
