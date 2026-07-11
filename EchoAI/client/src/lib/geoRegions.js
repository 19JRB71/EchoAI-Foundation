// Client mirror of the geo region definitions in Zorecho/utils/geoTargeting.js.
// KEEP IN SYNC with the server (region codes, names, cities).

export const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Regional breakdowns for large states. Each checkbox shows its major cities.
export const STATE_REGIONS = {
  FL: [
    { code: "FL_NORTH", name: "North Florida", cities: ["Jacksonville", "Tallahassee", "Gainesville", "Pensacola"] },
    { code: "FL_CENTRAL", name: "Central Florida", cities: ["Orlando", "Tampa", "Ocala", "Daytona Beach"] },
    { code: "FL_SOUTH", name: "South Florida", cities: ["Miami", "Fort Lauderdale", "West Palm Beach"] },
    { code: "FL_EAST_COAST", name: "East Coast Florida", cities: ["Jacksonville", "Daytona Beach", "Melbourne", "West Palm Beach", "Fort Lauderdale", "Miami"] },
    { code: "FL_WEST_COAST", name: "West Coast Florida", cities: ["Pensacola", "Tampa", "St. Petersburg", "Sarasota", "Fort Myers", "Naples"] },
    { code: "FL_PANHANDLE", name: "Florida Panhandle", cities: ["Pensacola", "Panama City", "Tallahassee"] },
  ],
  TX: [
    { code: "TX_NORTH", name: "North Texas", cities: ["Dallas", "Fort Worth", "Plano", "Arlington"] },
    { code: "TX_EAST", name: "East Texas", cities: ["Houston", "Beaumont", "Galveston", "Tyler"] },
    { code: "TX_CENTRAL", name: "Central Texas", cities: ["Austin", "San Antonio", "Waco", "Killeen"] },
    { code: "TX_SOUTH", name: "South Texas", cities: ["Corpus Christi", "Laredo", "McAllen", "Brownsville"] },
    { code: "TX_WEST", name: "West Texas", cities: ["El Paso", "Lubbock", "Midland", "Odessa", "Amarillo"] },
  ],
  CA: [
    { code: "CA_NORTH", name: "Northern California", cities: ["San Francisco", "San Jose", "Oakland", "Sacramento"] },
    { code: "CA_CENTRAL", name: "Central California", cities: ["Fresno", "Bakersfield", "Modesto", "Stockton"] },
    { code: "CA_SOUTH", name: "Southern California", cities: ["Los Angeles", "San Diego", "Anaheim", "Riverside", "Long Beach"] },
  ],
  NY: [
    { code: "NY_NYC", name: "New York City", cities: ["Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island"] },
    { code: "NY_LONG_ISLAND", name: "Long Island", cities: ["Hempstead", "Babylon", "Islip", "Huntington"] },
    { code: "NY_HUDSON_VALLEY", name: "Hudson Valley", cities: ["Yonkers", "White Plains", "Poughkeepsie", "Newburgh"] },
    { code: "NY_UPSTATE", name: "Upstate New York", cities: ["Albany", "Syracuse", "Rochester", "Buffalo"] },
  ],
};

export const REGION_BY_CODE = Object.fromEntries(
  Object.entries(STATE_REGIONS).flatMap(([st, regions]) =>
    regions.map((r) => [r.code, { ...r, state: st }])
  )
);

// US state tile-grid layout (col, row) — a clean, clickable schematic US map.
export const US_TILE_GRID = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], WI: [5, 2], MI: [7, 2], NY: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IL: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3], RI: [11, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};
