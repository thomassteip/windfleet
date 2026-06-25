import AnalyticsDashboard from "@/components/analytics/AnalyticsDashboard";

export const metadata = {
  title: "WindFleet — Fleet Analytics",
  description:
    "Analytics on the global wind-assisted propulsion fleet: installations by year, technology mix, retrofit vs newbuild, and the OEM landscape.",
};

export default function AnalyticsPage() {
  return (
    <div className="h-screen w-screen">
      <AnalyticsDashboard />
    </div>
  );
}
