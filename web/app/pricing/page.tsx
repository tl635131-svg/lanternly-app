import { Suspense } from "react";
import type { Metadata } from "next";
import { PricingPage } from "@/components/marketing/pricing";
export const metadata: Metadata = { title: "Pricing" };
export default function Page() {
  return <Suspense><PricingPage /></Suspense>;
}
