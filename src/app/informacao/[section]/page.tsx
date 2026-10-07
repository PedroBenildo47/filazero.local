import { notFound } from "next/navigation";
import { InformationPage } from "@/components/InformationPage";
import { isInformationSection } from "@/lib/information-content";

export default async function InformationRoute({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isInformationSection(section)) notFound();
  return <InformationPage section={section} />;
}
