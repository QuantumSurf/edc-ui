// Theme 컨텍스트 객체 + 소비 훅.
// Provider(ThemeContext.tsx)와 분리해 둔 이유: 컴포넌트 파일이 컴포넌트만
// export 해야 Vite dev HMR(react-refresh)이 상태를 보존한 채 갱신된다.

import { createContext, useContext } from "react";

export type Theme = "light" | "dark";

export interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
