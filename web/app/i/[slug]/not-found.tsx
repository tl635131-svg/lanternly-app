import { EmptyPage } from "@/components/ui/empty-page";

export default function InviteNotFound() {
  return (
    <EmptyPage
      overline="404"
      title="We couldn't find this invitation"
      body="The link may be incomplete, or the hosts may have replaced it. Ask them for a fresh link."
      action={{ label: "Go home", href: "/" }}
    />
  );
}
