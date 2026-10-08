import { AppError } from "@/lib/errors";
import { created, getRequestMeta, route } from "@/lib/http";
import { publicOrganization, publicUser } from "@/server/serializers";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";
import { setSessionCookie } from "@/server/auth/session-cookie";
import {
  isRegistrationDocumentType,
  MAX_REGISTRATION_UPLOAD_BYTES,
} from "@/server/organizations/registration-document.rules";
import {
  selfRegisterOrganization,
  type RegistrationDocumentUpload,
  type RegistrationLogoUpload,
} from "@/server/organizations/self-registration.service";
import { selfRegistrationSchema } from "@/server/organizations/self-registration.schemas";

async function readMultipartBody(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw AppError.badRequest("Content-Type must be multipart/form-data");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw AppError.badRequest("Invalid Content-Length");
    }
    if (declaredBytes > MAX_REGISTRATION_UPLOAD_BYTES) {
      throw AppError.validation("Organization documents exceed the upload limit");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw AppError.badRequest("Multipart request body is required");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REGISTRATION_UPLOAD_BYTES) {
      await reader.cancel();
      throw AppError.validation("Organization documents exceed the upload limit");
    }
    chunks.push(value);
  }

  try {
    const body = new Blob(chunks.map((chunk) => new Uint8Array(chunk)));
    return await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw AppError.badRequest("Invalid multipart form data");
  }
}

export const POST = route(async (request) => {
  await enforceRateLimits([
    {
      key: ipKey("organization:self-register", request),
      rule: RATE_LIMITS.organizationRegister.ip,
    },
  ]);

  const formData = await readMultipartBody(request);
  const fields: Record<string, string | undefined> = {};
  const uploads: RegistrationDocumentUpload[] = [];
  let logo: RegistrationLogoUpload | undefined;

  for (const [key, value] of formData.entries()) {
    if (key === "logo") {
      if (!(value instanceof File)) {
        throw AppError.validation("The organization logo must be a file");
      }
      if (logo) {
        throw AppError.validation("Only one organization logo may be uploaded");
      }
      logo = {
        fileName: value.name,
        mimeType: value.type,
        bytes: Buffer.from(await value.arrayBuffer()),
      };
      continue;
    }

    if (key.startsWith("document.")) {
      const type = key.slice("document.".length);
      if (!isRegistrationDocumentType(type) || !(value instanceof File)) {
        throw AppError.validation("Invalid organization document field");
      }
      if (uploads.some((upload) => upload.type === type)) {
        throw AppError.validation("Only one file may be uploaded for each document type");
      }
      uploads.push({
        type,
        fileName: value.name,
        mimeType: value.type,
        bytes: Buffer.from(await value.arrayBuffer()),
      });
      continue;
    }

    if (typeof value !== "string" || Object.hasOwn(fields, key)) {
      throw AppError.validation("Multipart fields must be unique text fields or typed documents");
    }
    fields[key] = value.trim() || undefined;
  }

  const input = selfRegistrationSchema.parse(fields);
  const result = await selfRegisterOrganization(input, uploads, logo, getRequestMeta(request));
  await setSessionCookie(result.token, result.expiresAt);

  return created({
    user: publicUser(result.user),
    organization: publicOrganization(result.organization),
    activated: true,
    documentTypes: result.documentTypes,
    logo: result.logo,
  });
});
