// The Health Monitor decides the account's overall status (which drives the
// colored nav dot AND whether the owner gets alerted) purely from the severity
// of the issues that still need attention. That mapping — worst-severity-wins,
// with auto-fixed issues excluded — is the contract the whole feature hangs on,
// so it's pinned here. We also pin the screenshot data-URL parser's rejection of
// anything that isn't a real base64 image (the public support endpoint relies on
// it to never write junk to disk).

const { test, before } = require("node:test");
const assert = require("node:assert/strict");

let statusFromIssues;
let persistScreenshot;

before(() => {
  const mod = require("../controllers/healthMonitorController");
  statusFromIssues = mod.statusFromIssues;
  persistScreenshot = mod.persistScreenshot;
});

test("no issues → healthy", () => {
  assert.equal(statusFromIssues([]), "healthy");
});

test("only info issues → healthy (info doesn't raise the dot)", () => {
  assert.equal(statusFromIssues([{ severity: "info" }, { severity: "info" }]), "healthy");
});

test("a warning among infos → warning", () => {
  assert.equal(
    statusFromIssues([{ severity: "info" }, { severity: "warning" }]),
    "warning",
  );
});

test("any critical wins over warnings/infos", () => {
  assert.equal(
    statusFromIssues([
      { severity: "info" },
      { severity: "warning" },
      { severity: "critical" },
    ]),
    "critical",
  );
});

test("unknown/missing severity is treated as the lowest (info) rank", () => {
  assert.equal(statusFromIssues([{ severity: "bogus" }, {}]), "healthy");
});

test("persistScreenshot rejects a non-data-URL without writing anything", async () => {
  const out = await persistScreenshot("not-a-data-url");
  assert.deepEqual(out, { url: null, base64: null, mediaType: null });
});

test("persistScreenshot rejects a data-URL that isn't an image", async () => {
  const out = await persistScreenshot("data:text/plain;base64,aGVsbG8=");
  assert.deepEqual(out, { url: null, base64: null, mediaType: null });
});
