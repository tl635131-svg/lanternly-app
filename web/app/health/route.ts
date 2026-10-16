/** The API's own health endpoint, passed through (it used to be a next.config rewrite). Use /healthz for the web service. */
import { apiOrigin } from "@/lib/server-env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(`${apiOrigin()}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unreachable" }, { status: 503 });
  }
}
