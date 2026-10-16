import { AdminEventPage } from "@/components/admin/event-detail";
export const metadata = { title: "Event" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminEventPage id={id} />; }
