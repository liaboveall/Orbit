import assert from "node:assert/strict";
import { assessScan } from "./check-image-scan.mjs";
const policy = { version: 1, blockingIds: ["CVE-SYNTHETIC-IMPACT"] };
const report = { SchemaVersion: 2, ArtifactName: "synthetic", Metadata: { ImageID: "sha256:synthetic" }, Results: [
  { Target: "synthetic", Class: "os-pkgs", Vulnerabilities: [{ VulnerabilityID: "CVE-SYNTHETIC", PkgName: "example", Severity: "HIGH", InstalledVersion: "1" }] },
] };
assert.equal(assessScan(report, policy).blocked, false);
for (const change of [{ FixedVersion: "2" }, { VulnerabilityID: "CVE-SYNTHETIC-IMPACT" }]) {
  const changed = structuredClone(report);
  Object.assign(changed.Results[0].Vulnerabilities[0], change);
  assert.equal(assessScan(changed, policy).blocked, true);
}
for (const invalid of [{}, { ...report, Results: [] }, { ...report, Metadata: {} }, { ...report, Results: [{ Target: "x" }] }])
  assert.throws(() => assessScan(invalid, policy));
console.log("Image policy: upstream observation, fixable/confirmed-impact blocking and malformed evidence rejection passed.");
