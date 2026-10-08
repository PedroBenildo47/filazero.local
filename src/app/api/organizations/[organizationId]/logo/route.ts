import { created, getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { MAX_LOGO_BYTES } from "@/server/organizations/registration-document.rules";
import {
  clearOrganizationLogo,
  setOrganizationLogo,
} from "@/server/organizations/organization-logo.service";
import { readMultipartFile } from "@/server/http/multipart";

type Context = { params: Promise<{ organizationId: string }> };

/**
 * Manager uploads the organization's logo (PNG/JPEG, ≤ 2 MiB). The bytes are
 * sniffed server-side and stored in the database; `organizations.logo_url` is
 * pointed at the public read endpoint.
 */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;

  const upload = await readMultipartFile(request, {
    field: "file",
    maxBytes: MAX_LOGO_BYTES,
  });

  const result = await setOrganizationLogo(
    auth,
    organizationId,
    upload,
    getRequestMeta(request),
  );
  return created(result);
});

/** Manager removes the organization's logo. */
export const DELETE = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  return ok(await clearOrganizationLogo(auth, organizationId, getRequestMeta(request)));
});
