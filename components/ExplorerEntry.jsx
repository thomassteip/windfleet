"use client";

import dynamic from "next/dynamic";

// Globe relies on WebGL / window, so load it client-side only. Shared by every
// route that opens the explorer: "/", and the /analytics and /makers routes,
// which open it with that panel already showing.
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

export default function ExplorerEntry({ initialMaker = null, initialPanel = null }) {
  return <FleetExplorer initialMaker={initialMaker} initialPanel={initialPanel} />;
}
