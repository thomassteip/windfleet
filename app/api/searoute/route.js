import seaRouter from "@/lib/seaRouter.cjs";

const { seaRoute } = seaRouter;

// Run in the Node runtime (the path-finder + marnet need Node, not Edge).
export const runtime = "nodejs";

// GET /api/searoute?fromLng=&fromLat=&toLng=&toLat=
// Returns { coords: [[lat, lng], ...] } following shipping lanes, or
// { coords: [] } when no sea route exists. Uses the robust k-nearest snapping
// router (lib/seaRouter.cjs), shared with the offline fleet-route build.
export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const nums = ["fromLng", "fromLat", "toLng", "toLat"].map((k) =>
    parseFloat(sp.get(k))
  );
  if (nums.some((n) => Number.isNaN(n))) {
    return Response.json({ coords: [], error: "bad params" }, { status: 400 });
  }
  const [fromLng, fromLat, toLng, toLat] = nums;

  try {
    const coords =
      seaRoute({ lng: fromLng, lat: fromLat }, { lng: toLng, lat: toLat }) || [];
    return Response.json({ coords });
  } catch (e) {
    return Response.json({ coords: [], error: String(e) });
  }
}
