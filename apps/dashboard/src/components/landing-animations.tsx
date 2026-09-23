"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect } from "react";

const ROOT_SELECTOR = "[data-lb-landing-root]";

export function LandingAnimations() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    if (!root) return;

    gsap.registerPlugin(ScrollTrigger);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-lb-animate], [data-lb-reveal], [data-lb-stagger] > *", {
          clearProps: "all",
        });
        return;
      }

      gsap
        .timeline({ defaults: { duration: 0.42, ease: "power2.out" } })
        .from("[data-lb-header]", { y: -8 })
        .from("[data-lb-hero-copy] > *", { stagger: 0.05, y: 10 }, "-=0.24")
        .from("[data-lb-hero-stage]", { scale: 0.99, y: 12 }, "-=0.28");

      gsap.utils.toArray<HTMLElement>("[data-lb-reveal]").forEach((element) => {
        ScrollTrigger.create({
          onEnter: () => {
            gsap.from(element, {
              duration: 0.42,
              ease: "power2.out",
              y: 14,
            });
          },
          once: true,
          start: "top 84%",
          trigger: element,
        });
      });

      gsap.utils.toArray<HTMLElement>("[data-lb-stagger]").forEach((group) => {
        const children = Array.from(group.children);
        if (children.length === 0) return;

        ScrollTrigger.create({
          onEnter: () => {
            gsap.from(children, {
              duration: 0.4,
              ease: "power2.out",
              stagger: 0.055,
              y: 12,
            });
          },
          once: true,
          start: "top 86%",
          trigger: group,
        });
      });
    }, root);

    return () => context.revert();
  }, []);

  return null;
}
