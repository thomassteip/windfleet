// Shared visual constants for the WindFleet app.
// Categorical palette: IEA-style bright "pop" colours that read on both
// light and dark surfaces. Surface/text colours are theme tokens (CSS vars).

export const POP = {
  teal: "#2FB8A8",
  green: "#7FC75B",
  purple: "#9B7BD4",
  rose: "#E0719E",
  amber: "#F2B33D",
  coral: "#EF8A6B",
  slate: "#5C8AC9",
  cyan: "#34BBE6",
  grey: "#B9C0CC",
};

export const TECH_COLORS = {
  "Rotor Sail": POP.teal,
  "Suction Sail": POP.purple,
  "Wing Sail": POP.green,
  "Rigid Sail": POP.slate,
  "Soft Sail": POP.rose,
  "Kite": POP.amber,
};

// Roughly largest -> smallest fleet share; rigid sails sit next to wing sails
// as a related rigid family (drives legends & stacking order).
export const TECH_ORDER = [
  "Rotor Sail",
  "Suction Sail",
  "Wing Sail",
  "Rigid Sail",
  "Soft Sail",
  "Kite",
];

// Ship type: four distinct hues kept clear of the technology palette, plus the
// shared grey for "Other". Until Oct 2026 this was a blue ramp (navy -> pale
// blue), which made neighbouring bands hard to tell apart and put Ro-Ro's pale
// blue next to Other's grey. Ship types have no order, so they get separate
// hues, not shades of one. Validated with the dataviz skill's
// validate_palette.js in stacking order, against both chart surfaces (#fafbfd
// light, #090f1b dark): lightness band, chroma, colour-blind separation
// (worst adjacent dE 18.2) and >= 3:1 contrast all pass in both themes.
export const SHIP_COLORS = {
  "Tanker": "#2F6CB3",
  "Bulk Carrier": "#D96B43",
  "General Cargo": "#2895C4",
  "Ro-Ro / Ropax": "#A9831A",
  "Other": "#B9C0CC",
};

// Install type is a neutral graphite/grey duo — distinct from both the
// technology and ship-type palettes.
export const INSTALL_COLORS = {
  Newbuild: "#4E5D6C",
  Retrofit: "#C4CAD2",
};

// Globe surface colours per theme (ocean material, land, coastline, atmosphere).
export const GLOBE_THEME = {
  dark: {
    ocean: "#0a1626",
    oceanEmissive: "#0a1626",
    land: "rgba(24,40,62,0.92)",
    landSide: "rgba(8,16,28,0.4)",
    stroke: "#33536f",
    atmosphere: "#ffffff",
    selected: "#ffffff",
  },
  light: {
    ocean: "#d4e2ee",
    oceanEmissive: "#cdd9e6",
    land: "rgba(176,193,210,0.95)",
    landSide: "rgba(150,170,190,0.5)",
    stroke: "#ffffff",
    atmosphere: "#9cc0e0",
    selected: "#16202e",
  },
};

export function techColor(tech) {
  return TECH_COLORS[tech] || POP.grey;
}
