/**
 * Render health check for the web service. Answers 200 as long as Next.js is serving; it does not call the API,
 * so a slow or sleeping API never marks the web service unhealthy. `?deep=1` also checks the API.
 */
import { apiOrigin } from "@/lib/server-env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const body: Record<string, unknown> = { status: "ok", service: "web", time: new Date().toISOString() };
  if (new URL(req.url).searchParams.get("deep") === "1") {
    try {
      const r = await fetch(`${apiOrigin()}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      body.api = r.ok ? "ok" : `status ${r.status}`;
      if (!r.ok) return Response.json(body, { status: 503, headers: { "cache-control": "no-store" } });
    } catch {
      body.api = "unreachable";
      return Response.json(body, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
