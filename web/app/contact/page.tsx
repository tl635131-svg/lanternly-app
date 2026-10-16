import type { Metadata } from "next";
import { ContactPage } from "@/components/marketing/contact";
import { brand } from "@/theme/brand";

export const metadata: Metadata = { title: `Contact · ${brand.name}` };
export default function Page() {
  return <ContactPage />;
}
