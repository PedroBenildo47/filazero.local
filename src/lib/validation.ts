/**
 * Shared validation primitives (zod).
 *
 * These are used at every API boundary. Frontend validation is a convenience;
 * the backend always re-validates.
 */
import { z } from "zod";

/** UUID v4-ish identifier used for every primary key in the schema. */
export const uuidSchema = z.string().uuid();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(255);

/// Angolan-friendly phone: optional leading +, digits/spaces/dashes, 7..20 chars.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid phone number");

/**
 * Angolan mobile number, normalised to the international `+2449XXXXXXXX` form.
 * Accepts `923 456 789`, `923456789`, `+244 923 456 789` or `00244923456789`.
 */
export const angolanPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .transform((value) => value.replace(/^(\+|00)?244/, "").replace(/^0+/, ""))
  .refine((value) => /^9\d{8}$/.test(value), { message: "invalid_angolan_phone" })
  .transform((value) => `+244${value}`);

/** Formats a normalised `+2449XXXXXXXX` number as `+244 9XX XXX XXX`. */
export function formatAngolanPhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^(00)?244/, "").replace(/^0+/, "");
  if (digits.length !== 9) return value;
  return `+244 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationToSkipTake(pagination: Pagination) {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}

/** Parses a JSON request body and returns a typed, validated value. */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Request body must be valid JSON",
      },
    ]);
  }
  return schema.parse(raw);
}

/** Parses and validates URL query parameters. */
export function parseSearchParams<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): z.infer<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return schema.parse(params);
}
