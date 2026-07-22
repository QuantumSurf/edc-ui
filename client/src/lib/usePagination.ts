// 클라이언트 사이드 페이지네이션 훅.
// DataTablePagination 컴포넌트와 분리해 둔 이유: 컴포넌트 파일이 컴포넌트만
// export 해야 Vite dev HMR(react-refresh)이 상태를 보존한 채 갱신된다.

import { useState, useEffect } from "react";

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
