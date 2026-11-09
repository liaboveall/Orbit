import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function assessScan(report, policy) {
  if (report?.SchemaVersion !== 2 || !report.ArtifactName || !report.Metadata?.ImageID || !Array.isArray(report.Results) || report.Results.length === 0)
    throw new Error("Missing or invalid container scan evidence");
  if (policy?.version !== 1 || !Array.isArray(policy.blockingIds)) throw new Error("Invalid image security policy");
  const findings = [];
  for (const result of report.Results) {
    if (!result.Target || !result.Class || (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)))
      throw new Error("Invalid scan result");
    for (const vulnerability of result.Vulnerabilities ?? []) {
      if (!vulnerability.VulnerabilityID || !vulnerability.PkgName || !vulnerability.Severity) throw new Error("Invalid vulnerability entry");
      if (["HIGH", "CRITICAL"].includes(vulnerability.Severity)) findings.push({
        id: vulnerability.VulnerabilityID, package: vulnerability.PkgName, severity: vulnerability.Severity,
        installed: vulnerability.InstalledVersion, fixed: vulnerability.FixedVersion ?? "",
        blocked: Boolean(vulnerability.FixedVersion?.trim()) || policy.blockingIds.includes(vulnerability.VulnerabilityID),
      });
    }
  }
  return { image: report.ArtifactName, imageId: report.Metadata.ImageID, findings, blocked: findings.some(item => item.blocked),
    acceptedUpstreamFindings: findings.filter(item => !item.blocked).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Supply one or more Trivy JSON reports");
  const policy = JSON.parse(await readFile(new URL("../infra/image-security-policy.json", import.meta.url), "utf8"));
  for (const path of paths) {
    const result = assessScan(JSON.parse(await readFile(path, "utf8")), policy);
    console.log(JSON.stringify({ report: path, ...result }));
    if (result.blocked) process.exitCode = 1;
  }
}
