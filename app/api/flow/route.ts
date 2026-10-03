import { normalize, type Flow } from "@/lib/flow";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  // Each caller supplies their own token. Same-origin validation limits browser misuse;
  // it is not authentication. Tokens and feed snapshots are never stored.
  const origin = request.headers.get("origin");
  // Next.js may construct request.url using its internal listening address.
  // Host retains the address the browser opened (localhost, LAN IP or HTTPS).
  const urlOrigin = new URL(request.url);
  const host = request.headers.get("host") || urlOrigin.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || urlOrigin.protocol.slice(0, -1);
  const expectedOrigin = `${protocol}://${host}`;
  if (!["http", "https"].includes(protocol) || !origin || origin !== expectedOrigin) return json({ error: "Use the feed connection inside the scanner." }, 403);
  const token = request.headers.get("x-flow-token")?.trim();
  if (!token || token.length < 8 || token.length > 512 || /[\s\x00-\x1f]/.test(token)) return json({ error: "Enter a valid API token from your Unusual Whales API account." }, 400);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Expected a JSON request." }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > 1024) return json({ error: "Request is too large." }, 413);
  try {
    const body = await request.text();
    if (body.length > 1024) return json({ error: "Request is too large." }, 413);
    let params: { limit?: number };
    try { params = JSON.parse(body); } catch { return json({ error: "Invalid request." }, 400); }
    if (!params || typeof params !== "object" || (params.limit != null && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 200))) return json({ error: "Request a limit between 1 and 200." }, 400);
    const url = new URL("https://api.unusualwhales.com/api/option-trades/flow-alerts");
    url.searchParams.set("limit", String(params.limit ?? 200));
    const result = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) return json({ error: "The provider rejected this token. Check your API subscription and token permissions." }, 401);
      if (result.status === 429) return json({ error: "The provider’s rate limit was reached. Pause auto-refresh and try again later." }, 429);
      return json({ error: `The provider is unavailable (HTTP ${result.status}). Try again shortly.` }, 502);
    }
    const payload = await result.json() as { data?: unknown[] };
    if (!Array.isArray(payload.data)) return json({ error: "Unexpected provider response. No sample data has been substituted." }, 502);
    const flows: Flow[] = []; let rejected = 0; const seen = new Set<string>();
    for (const row of payload.data) {
      const f = row && typeof row === "object" ? normalize(row as Record<string, unknown>) : null;
      if (f && !seen.has(f.id)) { flows.push(f); seen.add(f.id); } else rejected++;
    }
    if (payload.data.length && !flows.length) return json({ error: "The provider returned alerts the scanner could not read. No sample data has been substituted." }, 502);
    return json({ flows, rejected, fetchedAt: new Date().toISOString(), source: "unusual-whales" });
  } catch (e) {
    return json({ error: e instanceof Error && /timeout|abort/i.test(e.name) ? "The provider took too long to respond. Try again." : "Could not reach the data provider. Check your connection and try again." }, 502);
  }
}
