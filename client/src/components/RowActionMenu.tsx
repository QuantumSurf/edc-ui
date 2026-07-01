// 목록 표의 행 단위 작업 메뉴(케밥 ⋮). shadcn DropdownMenu(Radix) 기반 —
// 외부 클릭/Esc 닫기·포지셔닝·포털·키보드 내비게이션을 기본 제공한다.
// 자산/정책/계약 목록의 '액션' 컬럼에서 공통 사용.

import { Fragment } from "react";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** 이 항목 앞에 구분선 표시 */
  separatorBefore?: boolean;
}

export function RowActionMenu({
  actions,
  ariaLabel = "행 작업",
}: {
  actions: RowAction[];
  ariaLabel?: string;
}) {
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          // 트리거 클릭이 행 onClick(상세 열기 등)으로 전파되지 않게 차단.
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {actions.map((a, i) => (
          <Fragment key={i}>
            {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={a.destructive ? "destructive" : "default"}
              disabled={a.disabled}
              onSelect={() => a.onClick()}
              className="text-[13px] gap-2 cursor-pointer"
            >
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
