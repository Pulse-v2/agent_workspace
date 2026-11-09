"use client";

import { useSyncExternalStore } from "react";

/**
 * SVG presentation attributes (fill, stroke) do not resolve CSS var(), so
 * Recharts needs concrete colors. This reads the theme tokens from :root and
 * re-reads them when the theme class changes.
 */
const TOKENS = ["success", "destructive", "info", "primary", "border", "muted", "muted-foreground", "popover", "popover-foreground"] as const;
export type ThemeColors = Record<(typeof TOKENS)[number], string>;

const FALLBACK: ThemeColors = {
  success: "#2f9e6b", destructive: "#d9534f", info: "#3b7dd8", primary: "#24476a", border: "#e3e7ec",
  muted: "#f1f4f7", "muted-foreground": "#6b7785", popover: "#ffffff", "popover-foreground": "#1c2a3a",
};

let cachedKey = "";
let cachedColors = FALLBACK;

function read(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(TOKENS.map((token) => [token, style.getPropertyValue(`--${token}`).trim() || FALLBACK[token]])) as ThemeColors;
  const key = JSON.stringify(colors);
  if (key !== cachedKey) {
    cachedKey = key;
    cachedColors = colors;
  }
  return cachedColors;
}

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useThemeColors(): ThemeColors {
  return useSyncExternalStore(subscribe, read, () => FALLBACK);
}
