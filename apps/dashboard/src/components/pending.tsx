"use client";

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";

/** Clears a pending state when the browser restores this page from its back/forward cache. */
function useResetOnRestore(reset: () => void) {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [reset]);
}

/**
 * A form that posts to a URL and shows it is working until the next page loads: the pressed
 * button gets a spinner and every button reads as unavailable. Buttons get aria-disabled rather
 * than disabled, because a disabled submitter would drop its name and value from the request. A
 * second submit while the first is in flight is ignored.
 */
export function PendingForm({ children, onSubmit, ...props }: ComponentProps<"form">) {
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const reset = useCallback(() => {
    submitting.current = false;
    for (const button of form.current?.querySelectorAll("button") ?? []) {
      button.removeAttribute("aria-busy");
      button.removeAttribute("aria-disabled");
    }
  }, []);
  useResetOnRestore(reset);

  return (
    <form
      {...props}
      onSubmit={(event) => {
        if (submitting.current) {
          event.preventDefault();
          return;
        }
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        submitting.current = true;
        for (const button of event.currentTarget.querySelectorAll("button")) {
          button.setAttribute("aria-disabled", "true");
        }
        (event.nativeEvent as SubmitEvent).submitter?.setAttribute("aria-busy", "true");
      }}
      ref={form}
    >
      {children}
    </form>
  );
}

/**
 * A link that starts a full-page flow (such as sign-in at the identity provider) and shows a
 * spinner until the browser leaves. Clicks that open a new tab are left alone.
 */
export function PendingLink({
  children,
  href,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const [pending, setPending] = useState(false);
  useResetOnRestore(useCallback(() => setPending(false), []));

  return (
    <a
      {...props}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      href={href}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
        const newTab =
          event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (!event.defaultPrevented && !newTab) setPending(true);
      }}
    >
      {children}
    </a>
  );
}
