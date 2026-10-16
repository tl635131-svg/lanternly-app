import { EventShell } from "@/components/host/event-shell";
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventShell eventId={eventId}>{children}</EventShell>;
}
