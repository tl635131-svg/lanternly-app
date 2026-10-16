import Link from "next/link";
import { brand } from "@/theme/brand";

/** Brand logo slot: driven entirely by theme/brand.ts. */
export function Logo({ dark = false, height = 30, href = "/" }: { dark?: boolean; height?: number; href?: string | null }) {
  const w = Math.round((brand.logo.width / brand.logo.height) * height);
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={dark ? brand.logo.dark : brand.logo.light} alt={brand.name} width={w} height={height} style={{ height, width: "auto" }} />;
  if (!href) return img;
  return <Link href={href} aria-label={`${brand.name} home`} className="inline-flex items-center rounded-sm">{img}</Link>;
}
export function BrandSymbol({ size = 32, dark = false }: { size?: number; dark?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dark ? brand.logo.symbolDark : brand.logo.symbol} alt="" width={size} height={size} aria-hidden />;
}
export const BRAND_NAME = brand.name;
