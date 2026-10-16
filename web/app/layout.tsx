import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { brand } from "@/theme/brand";
import { brandCssVars, brandFontFaces } from "@/theme/css";
import { ToastProvider } from "@/components/ui/toast";
import { publicBaseUrl } from "@/lib/server-env";

/** Absolute URLs in metadata (Open Graph) use PUBLIC_BASE_URL, or the request's own host when it isn't set. */
export async function generateMetadata(): Promise<Metadata> {
  const base = publicBaseUrl(await headers());
  const description = "Digital wedding invitations with RSVPs, personal guest links, seating and live replies.";
  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: { default: `${brand.name} · ${brand.tagline}`, template: `%s · ${brand.name}` },
    description,
    icons: { icon: brand.logo.symbol },
    openGraph: { siteName: brand.name, type: "website", description },
  };
}

export const viewport: Viewport = { themeColor: brand.colors.night, width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next can stamp the CSP nonce from proxy.ts on its scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <style id="brand-tokens" nonce={nonce} dangerouslySetInnerHTML={{ __html: brandFontFaces() + "\n" + brandCssVars() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-link inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-on-primary">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
