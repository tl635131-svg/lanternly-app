import { Suspense } from "react";
import type { Metadata } from "next";
import { Unsubscribe } from "@/components/auth/unsubscribe";
export const metadata: Metadata = { title: "Email preferences" };
export default function Page() {
  return <Suspense><Unsubscribe /></Suspense>;
}
