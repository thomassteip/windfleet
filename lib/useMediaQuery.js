"use client";

import { useEffect, useState } from "react";

// Subscribe to a CSS media query. Returns false during SSR / first paint so the
// desktop layout is the default, then updates on mount and whenever it changes.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}

// True on phone-sized viewports (Tailwind's md breakpoint is 768px).
export function useIsMobile() {
  return useMediaQuery("(max-width: 767px)");
}

// True on devices without a precise hover (touchscreens). Used to swap the
// pointer-following hover card for tap-to-open behaviour.
export function useHasHover() {
  return useMediaQuery("(hover: hover) and (pointer: fine)");
}
