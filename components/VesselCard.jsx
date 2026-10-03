"use client";

import { techColor } from "@/lib/theme";

function Row({ label, value, mono }) {
  if (value === null || value === undefined || value === "" || value === "None")
    return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-edge/40 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span
        className={`text-right text-sm text-fg/90 ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// "3 h ago" / "12 days ago" from an ISO timestamp. positionUpdated is the time
// the AIS message was HEARD (Open Waters' `seen`), not when our job ran, so an
// old value genuinely means the ship hasn't been picked up since.
function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const h = (Date.now() - t) / 36e5;
  if (h < 1) return "under an hour ago";
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Curated photos carry a credit from the workbook. Older scraped ones don't,
// so name the site they're served from rather than show them uncredited.
function photoCredit(v) {
  if (v.photoCredit) return v.photoCredit;
  if (/myshiptracking\.com/.test(v.photoUrl || "")) return "via MyShipTracking";
  if (/vesselfinder\.(com|net)/.test(v.photoUrl || "")) return "via VesselFinder";
  return null;
}

export default function VesselCard({ vessel, onClose }) {
  if (!vessel) return null;
  const color = techColor(vessel.technology);
  const num = (v, suffix = "") =>
    v === null || v === undefined || v === "None"
      ? null
      : `${Number(v).toLocaleString()}${suffix}`;

  return (
    <div className="fade-up scroll-thin pointer-events-auto max-h-[70vh] w-full overflow-y-auto rounded-2xl border border-edge/60 bg-panel/90 p-5 backdrop-blur-md md:max-h-[calc(100vh-7.5rem)] md:w-80">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: color, boxShadow: `0 0 10px ${color}` }}
            />
            <h2 className="text-lg font-semibold leading-tight">
              {vessel.name}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted">
            {vessel.technology} · {vessel.type}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-fg"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Ship photo — workbook "Photo URL" / "Photo Credit"; hidden if it fails to load */}
      {vessel.photoUrl && (
        <figure className="mt-4 overflow-hidden rounded-xl border border-edge/50">
          <img
            src={vessel.photoUrl}
            alt={vessel.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-36 w-full object-cover"
            onError={(e) => {
              e.currentTarget.parentElement.style.display = "none";
            }}
          />
          {photoCredit(vessel) && (
            <figcaption className="px-2 py-1 text-right text-[10px] text-muted/70">
              Photo: {photoCredit(vessel)}
            </figcaption>
          )}
        </figure>
      )}

      {/* Live position block */}
      {vessel.lat != null && (
        <div className="mt-4 rounded-xl border border-edge/50 bg-ink/40 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted/70">
            Live position
          </div>
          <Row
            label="Status"
            value={vessel.navStatus}
          />
          <Row
            label="Speed"
            value={vessel.speed != null ? `${vessel.speed} kn` : null}
            mono
          />
          <Row
            label="Course"
            value={vessel.course != null ? `${Math.round(vessel.course)}°` : null}
            mono
          />
          <Row
            label="Destination"
            value={vessel.destination}
            mono
          />
          <Row
            label="Last port"
            value={vessel.lastPort}
          />
          {vessel.positionUpdated && ago(vessel.positionUpdated) && (
            <p
              className="mt-1.5 text-[10px] text-muted/60"
              title={vessel.positionUpdated}
            >
              Last AIS fix{" "}
              <span className="font-mono tabular-nums">
                {ago(vessel.positionUpdated)}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3">
        <Row label="OEM" value={vessel.oem !== "None" ? vessel.oem : null} />
        <Row label="Units" value={vessel.units} mono />
        <Row
          label="System size"
          value={
            vessel.systemSize
              ? `${vessel.systemSize} ${vessel.systemSizeUnit || ""}`.trim()
              : null
          }
          mono
        />
        <Row label="Installed" value={vessel.installedYear} mono />
        <Row label="Install type" value={vessel.installType} />
        <Row label="Built" value={vessel.builtYear} mono />
        <Row label="DWT" value={num(vessel.dwt, " t")} mono />
        <Row label="GT" value={num(vessel.gt)} mono />
        <Row
          label="Dimensions"
          value={vessel.loa ? `${vessel.loa} × ${vessel.beam || "?"} m` : null}
          mono
        />
        <Row label="Shipowner" value={vessel.shipowner !== "None" ? vessel.shipowner : null} />
        <Row label="Operator" value={vessel.operator !== "None" ? vessel.operator : null} />
        <Row label="Status" value={vessel.status} />
      </div>

      {/* External links */}
      <div className="mt-4 flex gap-2">
        {vessel.vfUrl && (
          <a
            href={vessel.vfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg border border-edge/60 py-1.5 text-center text-[11px] text-muted transition hover:border-accent hover:text-fg"
          >
            VesselFinder ↗
          </a>
        )}
        {vessel.mstUrl && (
          <a
            href={vessel.mstUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg border border-edge/60 py-1.5 text-center text-[11px] text-muted transition hover:border-accent hover:text-fg"
          >
            MyShipTracking ↗
          </a>
        )}
      </div>
    </div>
  );
}
