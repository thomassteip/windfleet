import ExplorerEntry from "@/components/ExplorerEntry";

export const metadata = {
  title: "WindFleet — Fleet Analytics",
  description:
    "Analytics on the global wind-assisted propulsion fleet: installations by year, technology mix, retrofit vs newbuild, and the makers behind the systems.",
};

// /analytics opens the explorer with the analytics panel showing, the same way
// /makers opens it with the makers panel. It used to be a separate,
// dashboard-only page; giving the panel this address is what lets the
// browser's Back button close it again.
export default function AnalyticsPage() {
  return <ExplorerEntry initialPanel="analytics" />;
}
