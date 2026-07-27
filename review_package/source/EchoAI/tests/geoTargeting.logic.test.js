const test = require("node:test");
const assert = require("node:assert");
const {
  fbGeoLocations,
  classifyLeadGeo,
  textMentionsExcluded,
} = require("../utils/geoTargeting");

test("fbGeoLocations: state + zip exclusions are hard FB-level blocks", () => {
  const geo = {
    areas: [{ type: "state", value: "FL" }],
    exclusions: [
      { type: "state", value: "NY" },
      { type: "zip", value: "08103" },
    ],
  };
  const t = fbGeoLocations(geo);
  assert.ok(t.geo_locations.regions.length === 1);
  assert.ok(t.excluded_geo_locations.regions.some((r) => r.key));
  assert.deepStrictEqual(
    t.excluded_geo_locations.zips.map((z) => z.key),
    ["US:08103"],
  );
});

test("fbGeoLocations: city exclusion outside every targeted state fail-closes by excluding its whole state", () => {
  const geo = {
    areas: [{ type: "state", value: "FL" }],
    exclusions: [{ type: "city", value: "Camden", state: "NJ" }],
  };
  const t = fbGeoLocations(geo);
  assert.ok(
    t.excluded_geo_locations &&
      t.excluded_geo_locations.regions &&
      t.excluded_geo_locations.regions.length === 1,
    "NJ should be hard-excluded at the FB level",
  );
});

test("fbGeoLocations: city exclusion inside a targeted state never wipes the service area", () => {
  const geo = {
    areas: [{ type: "city", value: "Newark", state: "NJ" }],
    exclusions: [{ type: "city", value: "Camden", state: "NJ" }],
  };
  const t = fbGeoLocations(geo);
  assert.ok(t.geo_locations.regions.length === 1, "NJ stays targeted");
  assert.strictEqual(t.excluded_geo_locations, undefined);
});

test("fbGeoLocations: no configured areas targets the US, exclusions still applied", () => {
  const geo = { areas: [], exclusions: [{ type: "state", value: "CA" }] };
  const t = fbGeoLocations(geo);
  assert.deepStrictEqual(t.geo_locations.countries, ["US"]);
  assert.ok(t.excluded_geo_locations.regions.length === 1);
});

test("classifyLeadGeo: excluded beats in-area; unknown location is null", () => {
  const geo = {
    areas: [{ type: "state", value: "NJ" }],
    exclusions: [{ type: "city", value: "Camden", state: "NJ" }],
  };
  assert.strictEqual(classifyLeadGeo(geo, { city: "Camden", state: "NJ" }), "excluded");
  assert.strictEqual(classifyLeadGeo(geo, { city: "Newark", state: "NJ" }), "in_area");
  assert.strictEqual(classifyLeadGeo(geo, { state: "TX" }), "out_of_area");
  assert.strictEqual(classifyLeadGeo(geo, {}), null);
  assert.strictEqual(classifyLeadGeo(null, { state: "NJ" }), null);
});

test("textMentionsExcluded: flags excluded state names, cities, and zips in free text", () => {
  const geo = {
    areas: [],
    exclusions: [
      { type: "state", value: "NY" },
      { type: "city", value: "Camden", state: "NJ" },
      { type: "zip", value: "08103" },
    ],
  };
  assert.ok(textMentionsExcluded(geo, "Expand ads into New York suburbs").length === 1);
  assert.ok(textMentionsExcluded(geo, "Target Camden homeowners").length === 1);
  assert.ok(textMentionsExcluded(geo, "zip 08103 looks promising").length === 1);
  assert.deepStrictEqual(textMentionsExcluded(geo, "Focus on Miami"), []);
});
test("normalizeGeo: country + region entries validate and label correctly", () => {
  const { normalizeGeo } = require("../utils/geoTargeting");
  const geo = normalizeGeo({
    areas: [
      { type: "country", value: "US" },
      { type: "region", value: "FL_NORTH" },
    ],
    exclusions: [],
  });
  assert.deepStrictEqual(geo.areas[0], { type: "country", value: "US", label: "United States (nationwide)" });
  assert.strictEqual(geo.areas[1].state, "FL");
  assert.strictEqual(geo.areas[1].label, "North Florida");
  assert.throws(() => normalizeGeo({ areas: [{ type: "region", value: "FL_NOPE" }] }));
  assert.throws(() => normalizeGeo({ areas: [{ type: "country", value: "CA" }] }), /United States/);
  // regions/country are never valid exclusions
  assert.throws(() => normalizeGeo({ exclusions: [{ type: "country", value: "US" }] }));
  assert.throws(() => normalizeGeo({ exclusions: [{ type: "region", value: "FL_NORTH" }] }));
});

test("fbGeoLocations: nationwide country targets US; state exclusions still carve out", () => {
  const geo = {
    areas: [{ type: "country", value: "US" }, { type: "state", value: "FL" }],
    exclusions: [{ type: "state", value: "NY" }],
  };
  const t = fbGeoLocations(geo);
  assert.deepStrictEqual(t.geo_locations.countries, ["US"]);
  assert.strictEqual(t.geo_locations.regions, undefined, "country supersedes state list");
  assert.ok(t.excluded_geo_locations.regions.length === 1);
});

test("fbGeoLocations: region areas target their state at the FB level", () => {
  const t = fbGeoLocations({ areas: [{ type: "region", value: "FL_NORTH", state: "FL" }], exclusions: [] });
  assert.ok(t.geo_locations.regions.some((r) => r.key === "3852"), "FL region key");
});

test("classifyLeadGeo: country = everywhere in-area; region matches its state", () => {
  const usGeo = { areas: [{ type: "country", value: "US" }], exclusions: [{ type: "state", value: "NY" }] };
  assert.strictEqual(classifyLeadGeo(usGeo, { state: "TX" }), "in_area");
  assert.strictEqual(classifyLeadGeo(usGeo, { state: "NY" }), "excluded");
  const regGeo = { areas: [{ type: "region", value: "FL_NORTH", state: "FL" }], exclusions: [] };
  assert.strictEqual(classifyLeadGeo(regGeo, { state: "FL", city: "Jacksonville" }), "in_area");
  assert.strictEqual(classifyLeadGeo(regGeo, { state: "GA" }), "out_of_area");
});
