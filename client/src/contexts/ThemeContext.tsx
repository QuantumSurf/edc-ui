// Connector Hub — Theme Provider (light/dark)
// pcf-exchange-ui 셸 구조와 동일하게 Topbar 테마 토글을 지원한다.
// index.css 의 `.dark` 토큰을 documentElement 클래스 토글로 적용한다.
// 컨텍스트 객체와 useTheme 훅은 ./useTheme 에 있다.

import { useEffect, useState } from "react";
import { ThemeContext, type Theme } from "./useTheme";

const STORAGE_KEY = "kmx-edc-theme";

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    return (localStorage.getItem(STORAGE_KEY) as Theme) || defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
