import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeyboardEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 비네이티브 요소(div 등)를 버튼처럼 키보드 접근 가능하게 만드는 props 묶음.
 * role="button" + tabIndex=0 + Enter/Space 활성화(WCAG 2.1.1). 클릭 대상 div 에 스프레드.
 * 사용: <div {...clickable(() => open(x))} className="cursor-pointer">
 */
export function clickable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
