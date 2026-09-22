import { getRequestMeta, created, ok, route } from "@/lib/http";
import { parseJsonBody, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import {
  createOrganization,
  listOrganizations,
} from "@/server/organizations/organization.service";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
} from "@/server/organizations/organization.schemas";

export const GET = route(async (request) => {
  const context = await requireAuth();
  const query = parseSearchParams(request, listOrganizationsQuerySchema);
  return ok(await listOrganizations(context, query));
});

export const POST = route(async (request) => {
  const context = await requireAuth();
  const body = await parseJsonBody(request, createOrganizationSchema);
  const organization = await createOrganization(context, body, getRequestMeta(request));
  return created(organization);
});
