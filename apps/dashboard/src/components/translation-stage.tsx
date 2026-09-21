"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";
import styles from "@/app/landing.module.css";
import { LogoMark } from "./icons";

export function TranslationStage() {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;

    gsap.registerPlugin(ScrollTrigger);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-selection-fill]", { scaleX: 1 });
        gsap.set("[data-selection-text]", { color: "#1d4ed8" });
        gsap.set("[data-translation-marker]", { opacity: 1, x: 0 });
        gsap.set("[data-output-word]", { opacity: 1, y: 0 });
        return;
      }

      const timeline = gsap.timeline({
        defaults: { ease: "power3.out" },
        scrollTrigger: {
          once: true,
          start: "top 82%",
          trigger: root.current,
        },
      });

      timeline
        .fromTo(
          "[data-selection-fill]",
          { scaleX: 0, transformOrigin: "left center" },
          { duration: 0.35, scaleX: 1 },
        )
        .to("[data-selection-text]", { color: "#1d4ed8", duration: 0.15 }, "<0.14")
        .fromTo(
          "[data-translation-marker]",
          { opacity: 0, x: -18 },
          { duration: 0.22, opacity: 1, x: 0 },
          "-=0.08",
        )
        .fromTo(
          "[data-output-word]",
          { opacity: 0, y: 12 },
          { duration: 0.26, opacity: 1, stagger: 0.035, y: 0 },
          "-=0.05",
        );
    }, root);

    return () => context.revert();
  }, []);

  return (
    <div
      aria-label="An English sentence translated into Nepali"
      className={styles.translationStage}
      data-lb-hero-stage=""
      ref={root}
      role="img"
    >
      <div className={styles.sourceLine}>
        <span className={styles.languageName}>English source</span>
        <p lang="en">
          Her flight boards from{" "}
          <span className={styles.selection}>
            <span className={styles.selectionFill} data-selection-fill="" />
            <span className={styles.selectionText} data-selection-text="">
              Gate 14
            </span>
          </span>{" "}
          at 18:20.
        </p>
      </div>

      <div className={styles.translationMarker} data-translation-marker="">
        <LogoMark size={18} />
        <span>Translate to Nepali</span>
      </div>

      <div className={styles.outputLine} lang="ne">
        <span className={styles.languageName}>नेपाली अनुवाद</span>
        <p>
          {["उहाँको", "उडानको", "बोर्डिङ", "१८:२०", "मा", "गेट", "१४", "बाट", "हुन्छ।"].map((word) => (
            <span data-output-word="" key={word}>
              {word}{" "}
            </span>
          ))}
        </p>
      </div>

      <div aria-hidden="true" className={styles.scriptRail}>
        <span lang="en">Read</span>
        <span lang="ne">पढ्नुहोस्</span>
        <span lang="ja">読む</span>
        <span dir="rtl" lang="ar">
          اقرأ
        </span>
      </div>
    </div>
  );
}
