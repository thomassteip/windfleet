// Maker websites, curated by hand (like lib/locodes.js for ports). A website
// belongs to a company, not to a ship, so it doesn't live in the vessel
// workbook. Keyed by makerSlug(name) from lib/analytics.js.
//
// Every URL here was checked in Oct 2026 by loading the page and confirming it
// names the maker. Leave a maker out rather than guess: the obvious domains are
// not always theirs (solidsail.com is a coding school, selar.com sells digital
// products). Some sites build their page with JavaScript, so a plain fetch sees
// an empty shell (dealfeng.com did): check those in a real browser.
//
// Joint makers list each partner we could confirm, with a label. A single site
// can skip the label; the panel shows its hostname.

export const MAKER_SITES = {
  airseas: [{ url: "https://airseas.com" }],
  anemoi: [{ url: "https://anemoimarine.com" }],
  "bar-technologies": [{ url: "https://www.bartechnologies.uk" }],
  "beyond-the-sea": [{ url: "https://beyond-the-sea.com" }],
  bound4blue: [{ url: "https://bound4blue.com" }],
  cormoran: [{ url: "https://cormoran.tech" }],
  cssc: [{ url: "https://www.cssc.net.cn" }],
  dealfeng: [{ url: "https://www.dealfeng.com/home" }],
  dsic: [{ url: "https://www.dsic.cn" }],
  "eco-flettner": [{ url: "https://www.ecoflettner.de" }],
  econowind: [{ url: "https://econowind.nl" }],
  enercon: [{ url: "https://www.enercon.de/en" }],
  "gt-wings": [{ url: "https://gtwings.com" }],
  "hyundai-hd-ksoe": [{ url: "https://www.hd-ksoe.com" }],
  "mol-oshima": [
    { label: "MOL", url: "https://www.mol.co.jp/en/" },
    { label: "Oshima Shipbuilding", url: "https://en.osy.co.jp/" },
  ],
  "naos-design": [{ url: "https://www.naos-design.com" }],
  norsepower: [{ url: "https://www.norsepower.com" }],
  oceanbird: [{ url: "https://www.theoceanbird.com" }],
  oceanwings: [{ url: "https://www.oceanwings.com" }],
  // SolidSail is Chantiers de l'Atlantique's; its page lives on their site.
  solidsail: [
    { label: "Chantiers de l'Atlantique", url: "https://chantiers-atlantique.com/en/references/solid-sail-aeoldrive/" },
  ],
};

const host = (url) => new URL(url).hostname.replace(/^www\./, "");

/** [{ label, url }] for a maker slug; [] when we have none on record. */
export function makerSites(slug) {
  return (MAKER_SITES[slug] || []).map((s) => ({ label: s.label || host(s.url), url: s.url }));
}
