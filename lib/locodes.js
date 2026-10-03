// UN/LOCODE → [lng, lat] for the ports that appear in the fleet's AIS
// "destination" and "last port" fields. VesselFinder reports a UN/LOCODE for
// each port call (e.g. NLRTM001 = Rotterdam), which is a far more reliable key
// than the free-text port name. Coordinates are approximate port locations —
// scripts/build_routes.py (which mirrors this file) snaps each end to the
// nearest shipping lane when it precomputes routes offline, so rough positions
// are fine; the same coords are used client-side by lib/ports.js/resolvePort()
// just for the marker's direction bearing. Unknown LOCODEs simply fall back to
// name matching (see lib/ports.js) and, failing that, draw no route leg.
// Format: LOCODE: [lng, lat]
export const LOCODES = {
  AUNTL001: [151.78, -32.92], // Newcastle, Australia
  AUPHE001: [118.57, -20.31], // Port Hedland, Australia
  BEANR001: [4.40, 51.26],    // Antwerpen, Belgium
  BRACX001: [-41.01, -21.83], // Porto do Açu, Brazil
  BRITQ001: [-44.37, -2.57],  // Itaqui, Brazil
  BRPMA001: [-44.37, -2.56],  // Ponta da Madeira, Brazil
  BRSSO001: [-45.40, -23.80], // São Sebastião, Brazil
  CABCO001: [-68.15, 49.22],  // Baie Comeau, Canada
  CACOC001: [-73.23, 45.85],  // Contrecoeur, Canada
  CNDLC001: [121.65, 38.92],  // Dalian, China
  CNSHG002: [121.49, 31.23],  // Shanghai, China
  DEEME001: [7.18, 53.34],    // Emden, Germany
  DKHBO001: [9.79, 56.64],    // Hobro, Denmark
  ESGIJ001: [-5.70, 43.56],   // Gijón, Spain
  ESSDR001: [-3.81, 43.46],   // Santander, Spain
  FIPRV002: [25.55, 60.30],   // Porvoo (Kilpilahti), Finland
  FRDKK001: [2.37, 51.03],    // Dunkerque, France
  FRFOS001: [4.87, 43.42],    // Fos-sur-Mer, France
  FRSML001: [-2.02, 48.65],   // Saint-Malo, France
  GBBEL001: [-5.91, 54.61],   // Belfast, UK
  GBNCS001: [-1.45, 55.00],   // Newcastle upon Tyne, UK
  GBTEE001: [-1.15, 54.61],   // Teesport, UK
  GHTEM001: [0.01, 5.63],     // Tema, Ghana
  GRTHI002: [23.30, 38.30],   // Thisvi, Greece
  ITCAG001: [9.11, 39.20],    // Cagliari, Italy
  ITGOA001: [8.93, 44.40],    // Genova, Italy
  ITMDC001: [10.04, 44.03],   // Marina di Carrara, Italy
  JPMIZ001: [133.73, 34.50],  // Mizushima, Japan
  JPMYJ001: [132.71, 33.84],  // Matsuyama, Japan
  MGMJN001: [46.32, -15.72],  // Mahajanga, Madagascar
  MHMAJ001: [171.38, 7.09],   // Majuro, Marshall Islands
  MUPLU001: [57.50, -20.16],  // Port Louis, Mauritius
  NLHAR001: [5.41, 53.18],    // Harlingen, Netherlands
  NLRTM001: [4.14, 51.95],    // Rotterdam, Netherlands
  NLWAL001: [4.42, 51.89],    // Rotterdam Waalhaven, Netherlands
  NOBGO001: [5.32, 60.39],    // Bergen, Norway
  NOGUD001: [6.84, 60.87],    // Gudvangen, Norway
  NORAF001: [9.62, 59.13],    // Rafnes, Norway
  NOSUN001: [8.57, 62.67],    // Sunndalsøra, Norway
  SAJED001: [39.15, 21.49],   // Jeddah, Saudi Arabia
  SAJUB001: [49.66, 27.02],   // Jubail, Saudi Arabia
  SEGOT001: [11.95, 57.69],   // Göteborg, Sweden
  SESDL001: [17.31, 62.39],   // Sundsvall, Sweden
  SGSIN001: [103.85, 1.26],   // Singapore
  TGLFW001: [1.28, 6.12],     // Lomé, Togo
  THBKK001: [100.58, 13.68],  // Bangkok, Thailand
  USCRP001: [-97.40, 27.81],  // Corpus Christi, USA
  USGLS001: [-94.79, 29.31],  // Galveston, USA
  USHOU001: [-95.27, 29.73],  // Houston, USA
  USYIG001: [-97.21, 27.86],  // Ingleside, USA
  VUVLI001: [168.32, -17.74], // Port Vila, Vanuatu
  // Fleet AIS destinations that UN/LOCODE and the World Port Index carry no
  // coordinates for (added 2026-10). refresh_positions.py prints any new ones
  // as "unplaced destination codes" — add them here.
  AIBLP001: [-63.09, 18.17],  // Blowing Point, Anguilla
  AUDAM001: [116.71, -20.66], // Dampier, Australia
  BGBOJ001: [27.48, 42.49],   // Burgas, Bulgaria
  CACSC001: [-73.57, 45.40],  // Côte-Sainte-Catherine, Canada
  DKAVE001: [12.47, 55.60],   // Avedøre Holme, Denmark
  DKGED001: [11.93, 54.57],   // Gedser, Denmark
  DKNBG001: [10.80, 55.31],   // Nyborg, Denmark
  DKSKA001: [10.59, 57.72],   // Skagen, Denmark
  EEMUU001: [24.96, 59.50],   // Muuga, Estonia
  IDMUB001: [117.62, -0.29],  // Muara Berau, Indonesia
  JPFKY001: [133.43, 34.43],  // Fukuyama, Japan
  MYKUA001: [103.43, 3.98],   // Kuantan, Malaysia
  SEVAG001: [12.24, 57.10],   // Varberg, Sweden
};

// Look up a port's coordinates by UN/LOCODE. Returns { lat, lng } or null.
// Accepts the 5-character code ("NLRTM", what the AIS refresh stores) or
// VesselFinder's terminal-suffixed form ("NLRTM001").
export function locodeCoords(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  const p =
    LOCODES[c] ||
    LOCODES[c.slice(0, 5) + "001"] ||
    Object.entries(LOCODES).find(([k]) => k.startsWith(c.slice(0, 5)))?.[1];
  return p ? { lng: p[0], lat: p[1] } : null;
}
