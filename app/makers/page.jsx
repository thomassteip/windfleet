import ExplorerEntry from "@/components/ExplorerEntry";

export const metadata = {
  title: "WindFleet — WAPS makers",
  description:
    "Every company with a wind-assisted propulsion system in commercial service: rotor, suction, wing, rigid, kite and traditional sails, with their fleets on the globe.",
};

export default function MakersPage() {
  return <ExplorerEntry initialMaker="index" />;
}
