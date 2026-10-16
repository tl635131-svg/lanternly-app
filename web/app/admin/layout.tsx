import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session";
import { AdminShell } from "@/components/admin/shell";

export const metadata: Metadata = { title: { default: "Studio console", template: "%s · Studio console" }, robots: { index: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SessionProvider><AdminShell>{children}</AdminShell></SessionProvider>;
}
