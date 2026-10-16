import type { Metadata } from "next";
import { TokenLanding } from "@/components/auth/token";
export const metadata: Metadata = { title: "Secure link" };
export default function Page() {
  return <TokenLanding />;
}
