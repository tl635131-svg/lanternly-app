import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckoutWizard } from "@/components/marketing/wizard";
export const metadata: Metadata = { title: "Start your order" };
export default function Page() {
  return <Suspense><CheckoutWizard /></Suspense>;
}
