// 다이얼로그 하위 트리에서 IME(한글) 조합 상태를 공유하는 컨텍스트.
// shadcn 원본 dialog.tsx 에 얹은 커스텀 확장 — 조합 중 Enter/Esc 로 다이얼로그가
// 닫히는 문제를 막는다. dialog.tsx 밖으로 뺀 이유는 두 가지다:
//   1. 컴포넌트 파일이 컴포넌트만 export 해야 Vite dev HMR(react-refresh)이 성립한다.
//   2. shadcn 재생성 시 dialog.tsx 가 덮여도 이 확장이 살아남는다.

import * as React from "react";

export interface DialogComposition {
  isComposing: () => boolean;
  setComposing: (composing: boolean) => void;
  justEndedComposing: () => boolean;
  markCompositionEnd: () => void;
}

export const DialogCompositionContext = React.createContext<DialogComposition>({
  isComposing: () => false,
  setComposing: () => {},
  justEndedComposing: () => false,
  markCompositionEnd: () => {},
});

export const useDialogComposition = () =>
  React.useContext(DialogCompositionContext);
