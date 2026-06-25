"use client";

import dynamic from "next/dynamic";

// Globe relies on WebGL / window, so load it client-side only.
const FleetExplorer = dynamic(() => import("@/components/FleetExplorer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-ink text-muted">
      <span className="animate-pulse text-sm tracking-widest uppercase">
        Loading fleet…
      </span>
    </div>
  ),
});

export default function Home() {
  return <FleetExplorer />;
}
