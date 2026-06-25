// UN/LOCODE → [lng, lat] for the ports that appear in the fleet's AIS
// "destination" and "last port" fields. VesselFinder reports a UN/LOCODE for
// each port call (e.g. NLRTM001 = Rotterdam), which is a far more reliable key
// than the free-text port name. Coordinates are approximate port locations —
// the /api/searoute endpoint snaps each end to the nearest shipping lane, so
// rough positions are fine. Unknown LOCODEs simply fall back to name matching
// (see lib/ports.js) and, failing that, draw no route leg.
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
};

// Look up a port's coordinates by UN/LOCODE. Returns { lat, lng } or null.
export function locodeCoords(code) {
  if (!code) return null;
  const p = LOCODES[String(code).trim().toUpperCase()];
  return p ? { lng: p[0], lat: p[1] } : null;
}
