import type { ReactNode } from "react";

/**
 * Brief route-entry motion. It is CSS-only (opacity and transform, 160ms) so content is readable
 * almost as soon as it arrives and no animation library ships with dashboard pages. The shell keys
 * this by path, so each navigation replays it; reduced motion turns it off in app.css.
 */
export function DashboardMotion({ children }: { children: ReactNode }) {
  return <div className="dashboard-route">{children}</div>;
}
