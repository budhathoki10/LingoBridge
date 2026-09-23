"use client";

type PageItem = number | "left-ellipsis" | "right-ellipsis";

function pageItems(currentPage: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "right-ellipsis", pageCount];
  if (currentPage >= pageCount - 3) {
    return [
      1,
      "left-ellipsis",
      pageCount - 4,
      pageCount - 3,
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }
  return [
    1,
    "left-ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "right-ellipsis",
    pageCount,
  ];
}

export function Pagination({
  disabled = false,
  onPageChange,
  page,
  pageCount,
}: {
  disabled?: boolean;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className="pagination">
      <span className="pagination__position tabular">
        Page {page} of {pageCount}
      </span>
      <div className="pagination__controls">
        <button
          className="button button--small pagination__direction"
          disabled={page <= 1 || disabled}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Previous
        </button>
        <span className="pagination__pages">
          {pageItems(page, pageCount).map((item) =>
            typeof item === "number" ? (
              <button
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                className="pagination__page"
                disabled={disabled}
                key={item}
                onClick={() => onPageChange(item)}
                type="button"
              >
                {item}
              </button>
            ) : (
              <span aria-hidden="true" className="pagination__ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </span>
        <button
          className="button button--small pagination__direction"
          disabled={page >= pageCount || disabled}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
