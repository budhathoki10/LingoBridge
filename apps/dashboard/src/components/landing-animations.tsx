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
          opacity: 1,
        });
        return;
      }

      gsap
        .timeline({ defaults: { duration: 0.55, ease: "power3.out" } })
        .from("[data-lb-header]", { opacity: 0, y: -10 })
        .from("[data-lb-hero-copy] > *", { opacity: 0, stagger: 0.07, y: 18 }, "-=0.28")
        .from("[data-lb-hero-stage]", { opacity: 0, scale: 0.985, y: 18 }, "-=0.35");

      gsap.utils.toArray<HTMLElement>("[data-lb-reveal]").forEach((element) => {
        ScrollTrigger.create({
          onEnter: () => {
            gsap.from(element, {
              duration: 0.65,
              ease: "power3.out",
              opacity: 0,
              y: 26,
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
              duration: 0.55,
              ease: "power3.out",
              opacity: 0,
              stagger: 0.08,
              y: 20,
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
