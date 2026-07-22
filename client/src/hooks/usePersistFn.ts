import { useRef } from "react";

// 제네릭 제약용 '아무 함수' 타입. 매개변수는 반공변이라 unknown[] 을 쓰면 제약이 성립하지
// 않으므로(구체 시그니처가 대입 불가) never[] 를 쓴다. any 없이 동일한 유연성을 얻는다.
type noop = (...args: never[]) => unknown;

/**
 * usePersistFn instead of useCallback to reduce cognitive load
 */
export function usePersistFn<T extends noop>(fn: T) {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const persistFn = useRef<T>(null);
  if (!persistFn.current) {
    persistFn.current = function (this: unknown, ...args) {
      return fnRef.current!.apply(this, args);
    } as T;
  }

  return persistFn.current!;
}
