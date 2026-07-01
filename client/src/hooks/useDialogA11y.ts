import { useEffect, useRef } from "react";

/**
 * 슬라이드 패널/다이얼로그 접근성(WCAG 2.4.3 / 4.1.2):
 *  - open 시 패널 내부로 초기 포커스 이동
 *  - Tab/Shift+Tab 포커스 트랩(패널 밖으로 못 나가게)
 *  - close/언마운트 시 열기 전 트리거로 포커스 복원
 *  - open 동안 body 스크롤 락
 * 반환한 ref 를 패널 컨테이너에 붙이고 role="dialog" aria-modal="true" tabIndex={-1} 를 함께 준다.
 */
export function useDialogA11y<T extends HTMLElement = HTMLElement>(
  open: boolean
) {
  const ref = useRef<T>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    prevFocus.current = document.activeElement as HTMLElement | null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(el => el.offsetParent !== null);

    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || active === panel)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      prevFocus.current?.focus?.();
    };
  }, [open]);

  return ref;
}
