import { notFound } from "next/navigation";
import { getMuseum } from "@/lib/queries";
import MuseumClient from "@/components/museum/MuseumClient";

export const dynamic = "force-dynamic";

export default async function MuseumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getMuseum(slug);
  if (!data) notFound();
  return <MuseumClient data={data} />;
}
