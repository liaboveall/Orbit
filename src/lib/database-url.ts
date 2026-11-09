/** Docker development ports bind IPv4. Do not rewrite remote or TLS endpoints. */
export function localDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (process.platform === "win32" && url.hostname === "localhost" &&
      !["staging", "production"].includes(process.env.APP_ENV ?? "development") &&
      !url.searchParams.has("sslmode")) {
    url.hostname = "127.0.0.1";
    return url.href;
  }
  return value;
}
