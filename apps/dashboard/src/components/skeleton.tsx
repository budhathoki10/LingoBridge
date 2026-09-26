import type { ReactNode } from "react";

/**
 * The container for a route's loading placeholder. Placeholders are built from the page's own
 * markup and classes, so each block has the size, spacing, and radius of what replaces it on
 * both desktop and mobile.
 */
export function LoadingPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className={className ? `page ${className}` : "page"}
      role="status"
    >
      {children}
    </div>
  );
}

/**
 * A shimmering bar per line of `children`. The placeholder copy is invisible and hidden from
 * assistive technology; it exists so the bar wraps like the real text of similar length.
 */
export function SkeletonText({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="skeleton-text">
      {children}
    </span>
  );
}
