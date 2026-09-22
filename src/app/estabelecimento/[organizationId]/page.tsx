import { OrganizationView } from "./OrganizationView";

export default async function EstablishmentPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <OrganizationView organizationId={organizationId} />;
}
