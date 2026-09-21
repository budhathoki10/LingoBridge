"use client";

import { animate, stagger } from "animejs";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./sign-in.module.css";

/** Fades and lifts the direct `data-animate` children into place on load. */
export function SignInStage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = root.current.querySelectorAll("[data-animate]");
    animate(targets, {
      delay: stagger(90),
      duration: 520,
      ease: "outQuart",
      opacity: [0, 1],
      translateY: [16, 0],
    });
  }, []);

  return (
    <div className={styles.content} ref={root}>
      {children}
    </div>
  );
}
