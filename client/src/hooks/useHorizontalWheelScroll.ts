import { useEffect, useRef } from "react";

/**
 * 가로 스크롤 컨테이너에서 세로 마우스 휠(deltaY)을 가로 스크롤로 변환한다.
 * 반환한 ref 를 overflow-x 컨테이너에 붙인다.
 *
 * 동작 규칙(자연스러운 UX):
 *  - 가로로 넘치는 내용이 없으면 아무 것도 하지 않음(세로 스크롤 그대로).
 *  - 트랙패드의 가로 제스처(deltaX)는 브라우저 기본 처리에 맡김.
 *  - 가로 스크롤이 이미 양 끝에 닿았고 그 방향으로 더 굴리면 페이지 세로 스크롤로 넘김.
 */
export function useHorizontalWheelScroll<
  T extends HTMLElement = HTMLDivElement,
>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) return; // 이미 가로 제스처면 기본 처리
      if (e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return; // 넘치는 가로 내용 없음
      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) return; // 끝 → 페이지 세로 스크롤로
      // passive:false 라야 preventDefault 로 세로 스크롤을 막고 가로로 돌릴 수 있다.
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}
