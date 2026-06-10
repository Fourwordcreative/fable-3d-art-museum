import { getTimeline } from "@/lib/queries";
import TimelineApp from "@/components/TimelineApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const periods = await getTimeline();
  return <TimelineApp periods={periods} />;
}
