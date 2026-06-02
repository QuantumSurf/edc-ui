// Data Table Pagination — page-size selector + Previous/Next navigation
// Ported style from kmx-identityhub-ui

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

interface DataTablePaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  rowsPerPageLabel?: string;
}

export function DataTablePagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  rowsPerPageLabel = "페이지당 행 수",
}: DataTablePaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{rowsPerPageLabel}</span>
        <select
          className="border border-border rounded-md px-2 py-1 text-[12px] bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(parseInt(e.target.value, 10));
            onPageChange(1);
          }}
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {startItem}–{endItem} of {totalItems}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label={t.common.prev}
            className={cn(
              "p-1.5 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
              currentPage <= 1
                ? "border-border text-muted-foreground/40 cursor-not-allowed"
                : "border-border text-foreground/70 hover:bg-muted"
            )}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-foreground min-w-[60px] text-center">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label={t.common.next}
            className={cn(
              "p-1.5 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
              currentPage >= totalPages
                ? "border-border text-muted-foreground/40 cursor-not-allowed"
                : "border-border text-foreground/70 hover:bg-muted"
            )}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function usePagination<T>(data: T[], initialPageSize = 10) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage !== safePage) setCurrentPage(safePage);
  }, [currentPage, safePage]);

  const paginatedData = data.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  return {
    paginatedData,
    totalItems,
    currentPage: safePage,
    pageSize,
    setCurrentPage,
    setPageSize,
  };
}
