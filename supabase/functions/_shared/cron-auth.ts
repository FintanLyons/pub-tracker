/**
 * Scheduled / worker invokes must pass header x-cron-secret matching NOTIFICATION_CRON_SECRET.
 */
export function assertCronSecret(req: Request): void {
  const expected = Deno.env.get("NOTIFICATION_CRON_SECRET") ?? "";
  if (!expected) {
    throw new Error("NOTIFICATION_CRON_SECRET not configured");
  }
  const got = req.headers.get("x-cron-secret") ?? "";
  if (got !== expected) {
    throw new Error("Unauthorized");
  }
}
