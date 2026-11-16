export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "salesflow-theme";

/**
 * Runs inline in <head> before first paint so there is no light flash:
 * a stored choice wins, otherwise the OS preference.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;
