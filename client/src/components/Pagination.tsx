// KMX EDC — Pagination Component
// Reusable page navigation for list views

import { useI18n } from "@/i18n";
import { fmtNum } from "@/lib/format";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  total: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export const DEFAULT_PAGE_SIZE = 20;

export function Pagination({
  total,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
}: PaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  // Generate page numbers to show (max 5 visible)
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (
      let i = Math.max(2, page - 1);
      i <= Math.min(totalPages - 1, page + 1);
      i++
    )
      pages.push(i);
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  const btnClass =
    "w-7 h-7 flex items-center justify-center rounded-md text-[12px] transition-colors";

  return (
    <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
      <span className="text-[12px] text-muted-foreground">
        {fmtNum(start)}–{fmtNum(end)} / {fmtNum(total)}
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className={cn(
            btnClass,
            "text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          )}
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className={cn(
            btnClass,
            "text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          )}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {pages.map((p, i) =>
          p === "..." ? (
            <span
              key={`dots-${i}`}
              className="w-7 text-center text-[12px] text-muted-foreground/50"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                btnClass,
                p === page
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className={cn(
            btnClass,
            "text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          )}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className={cn(
            btnClass,
            "text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          )}
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Slice an array for the current page */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize = DEFAULT_PAGE_SIZE
): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
