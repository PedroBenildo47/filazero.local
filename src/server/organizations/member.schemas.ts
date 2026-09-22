import { z } from "zod";
import { MemberStatus } from "@prisma/client";
import {
  emailSchema,
  passwordSchema,
  phoneSchema,
  uuidSchema,
} from "@/lib/validation";

/** Roles that a membership row may carry. */
export const memberRoleSchema = z.enum(["STAFF", "MANAGER"]);

/**
 * Adds a member either by referencing an existing user (`userId`) or by
 * creating a brand new staff account (`name` + `email` + `password`).
 */
export const addMemberSchema = z
  .object({
    userId: uuidSchema.optional(),
    name: z.string().trim().min(2).max(160).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema.optional(),
    role: memberRoleSchema,
    /** null / omitted = access to every branch of the organization. */
    branchId: uuidSchema.nullish(),
  })
  .refine(
    (value) => Boolean(value.userId) || Boolean(value.name && value.email && value.password),
    {
      message: "Provide either userId or name, email and password",
      path: ["userId"],
    },
  );

export const updateMemberSchema = z.object({
  role: memberRoleSchema.optional(),
  branchId: uuidSchema.nullish(),
  status: z.nativeEnum(MemberStatus).optional(),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
