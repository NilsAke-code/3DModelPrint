import { useState, useEffect } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Apply saved theme immediately on mount to prevent flash
  useEffect(() => {
    applyTheme((localStorage.getItem(STORAGE_KEY) as Theme) ?? "dark");
  }, []);

  function toggle() {
    setTheme(t => (t === "dark" ? "light" : "dark"));
  }

  return [theme, toggle] as const;
}
