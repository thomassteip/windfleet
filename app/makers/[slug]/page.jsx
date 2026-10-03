import ExplorerEntry from "@/components/ExplorerEntry";
import { FALLBACK_ANALYTICS } from "@/lib/analytics";

// One pre-built page per maker in the bundled snapshot, so each has its own
// title and description for link previews and search. A maker that only exists
// in the live data still works: the page renders on demand and the panel fills
// in from the live fetch.
export function generateStaticParams() {
  return FALLBACK_ANALYTICS.MAKERS.map((m) => ({ slug: m.slug }));
}

export function generateMetadata({ params }) {
  const m = FALLBACK_ANALYTICS.MAKERS.find((x) => x.slug === params.slug);
  if (!m) return { title: "WindFleet — WAPS makers" };
  const tech = m.techs.join(" / ");
  return {
    title: `${m.name} — WindFleet`,
    description: `${m.name}${m.country ? ` (${m.country})` : ""}: ${m.count} vessel${
      m.count === 1 ? "" : "s"
    } with ${tech} in commercial service${m.first ? ` since ${m.first}` : ""}. Fleet, customers and installs on the WindFleet globe.`,
  };
}

export default function MakerPage({ params }) {
  return <ExplorerEntry initialMaker={params.slug} />;
}
