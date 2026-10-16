import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session";
import { AppHeader } from "@/components/host/header";
export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </SessionProvider>
  );
}
