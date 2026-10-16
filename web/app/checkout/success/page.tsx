import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckoutSuccess } from "@/components/auth/checkout-success";
export const metadata: Metadata = { title: "Order confirmed" };
export default function Page() {
  return <Suspense><CheckoutSuccess /></Suspense>;
}
