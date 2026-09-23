"use client";

import gsap from "gsap";
import { type ReactNode, useEffect, useRef } from "react";

/** Brief route-entry motion that preserves content visibility and respects reduced motion. */
export function DashboardMotion({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(root, { clearProps: "all" });
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        root,
        { opacity: 0, y: 8 },
        {
          clearProps: "opacity,transform",
          duration: 0.38,
          ease: "power2.out",
          opacity: 1,
          y: 0,
        },
      );
    }, root);

    return () => context.revert();
  }, []);

  return (
    <div className="dashboard-route" ref={container}>
      {children}
    </div>
  );
}
