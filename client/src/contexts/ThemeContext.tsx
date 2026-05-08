import React, { createContext, useContext, useEffect, useState } from "react";

export type AppTheme = "data-observatory" | "swiss-precision";

export interface ThemeDefinition {
  id: AppTheme;
  nameKey: string;
  descKey: string;
  preview: { bg: string; primary: string; sidebar: string };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "data-observatory",
    nameKey: "dataObservatory",
    descKey: "dataObservatoryDesc",
    preview: { bg: "#111827", primary: "#22d3ee", sidebar: "#0f1729" },
  },
  {
    id: "swiss-precision",
    nameKey: "swissPrecision",
    descKey: "swissPrecisionDesc",
    preview: { bg: "#f8fafc", primary: "#6366f1", sidebar: "#f1f5f9" },
  },
];

/** Dark themes where `dark:` variant should apply */
export const DARK_THEMES: AppTheme[] = ["data-observatory"];

export function isDarkTheme(theme: AppTheme): boolean {
  return DARK_THEMES.includes(theme);
}

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  themeDefinition: ThemeDefinition;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "kmx-edc-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
    return stored && THEMES.some((t) => t.id === stored) ? stored : "data-observatory";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (next: AppTheme) => setThemeState(next);
  const themeDefinition = THEMES.find((t) => t.id === theme)!;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themeDefinition }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
