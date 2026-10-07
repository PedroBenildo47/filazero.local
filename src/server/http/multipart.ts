/**
 * Multipart file reader with a hard size ceiling.
 *
 * Reads the body as a stream so an oversized upload is rejected before it is
 * buffered in memory, and trusts the declared `Content-Type` only to hand the
 * bytes to the multipart parser — the real type is sniffed by the caller.
 */
import "server-only";
import { AppError } from "@/lib/errors";

export interface UploadedFile {
  fileName: string;
  bytes: Uint8Array;
}

/** Multipart boundary overhead (headers, field names) allowed on top of the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function readMultipartFile(
  request: Request,
  options: { field: string; maxBytes: number },
): Promise<UploadedFile> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw AppError.badRequest("Content-Type must be multipart/form-data");
  }

  const limitBytes = options.maxBytes + MULTIPART_OVERHEAD_BYTES;
  const megabytes = Math.max(1, Math.floor(options.maxBytes / (1024 * 1024)));
  const tooLarge = () =>
    AppError.validation(`The uploaded file must be at most ${megabytes} MB.`);

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw AppError.badRequest("Invalid Content-Length");
    }
    if (declared > limitBytes) throw tooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) throw AppError.badRequest("Multipart request body is required");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > limitBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  let form: FormData;
  try {
    const body = new Blob(chunks.map((chunk) => new Uint8Array(chunk)));
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw AppError.badRequest("Invalid multipart form data");
  }

  const file = form.get(options.field);
  if (!(file instanceof File)) {
    throw AppError.validation(`A file must be sent in the "${options.field}" field.`);
  }

  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
