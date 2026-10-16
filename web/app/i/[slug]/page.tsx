import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { GuestInvite } from "@/components/invite/guest-invite";

import { apiOrigin } from "@/lib/server-env";
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Server-side lookup so a missing invitation answers with a real HTTP 404 (L-12). Cached per request. */
const lookup = cache(async (slug: string, preview?: string, g?: string, lang?: string) => {
  const q = new URLSearchParams();
  if (preview) q.set("preview", preview);
  if (g) q.set("g", g);
  if (lang) q.set("lang", lang);
  try {
    const r = await fetch(`${apiOrigin()}/api/public/invitations/${encodeURIComponent(slug)}?${q}`, { cache: "no-store" });
    return { status: r.status, data: r.ok ? await r.json() : null };
  } catch {
    return { status: 0, data: null }; // API unreachable: let the client show its retry state
  }
});

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await lookup(slug, one(sp.preview), one(sp.g), one(sp.lang));
  const fr = (r.data?.lang ?? one(sp.lang) ?? "").startsWith("fr");
  const invited = fr ? "Vous êtes invités" : "You're invited";
  if (r.data) return { title: { absolute: `${r.data.event.title} · ${invited}` }, description: r.data.content?.hero?.subtitle ?? undefined, robots: { index: false } };
  if (r.status === 404) return { title: { absolute: "Invitation not found" }, robots: { index: false } };
  return { title: { absolute: invited }, robots: { index: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await lookup(slug, one(sp.preview), one(sp.g), one(sp.lang));
  if (r.status === 404) notFound();
  // An old slug kept after a custom_link rename: move to the current link, keeping ?g=, ?lang=, ?preview=.
  const current = r.data?.invitation?.slug as string | undefined;
  if (current && current !== decodeURIComponent(slug).toLowerCase()) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v != null ? [v] : []) q.append(k, x);
    permanentRedirect(`/i/${encodeURIComponent(current)}${q.size ? `?${q}` : ""}`);
  }
  return <Suspense><GuestInvite /></Suspense>;
}
