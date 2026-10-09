import ExplorerEntry from "@/components/ExplorerEntry";

export const metadata = {
  title: "WindFleet — Fleet Data",
  description:
    "The full wind-assisted propulsion fleet as a sortable, filterable table, with CSV and JSON export.",
};

// /data opens the explorer with the Data panel (the fleet as a table) showing.
export default function DataPage() {
  return <ExplorerEntry initialPanel="data" />;
}
