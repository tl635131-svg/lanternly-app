import type { Metadata } from "next";
import { EmptyPage } from "@/components/ui/empty-page";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <EmptyPage
      overline="404"
      title="This page wandered off"
      body="The link may be mistyped, or the page may have moved. If someone sent you an invitation, check the link they shared."
      action={{ label: "Go home", href: "/" }}
      secondary={{ label: "My invitations", href: "/app" }}
    />
  );
}
