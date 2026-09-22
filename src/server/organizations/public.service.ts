/**
 * Public (unauthenticated) browsing of the directory.
 *
 * Customers must be able to find an establishment and see its open queues
 * before signing in. Only ACTIVE organizations/branches are exposed, and queue
 * detail is limited to non-sensitive fields.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";

export interface PublicDirectoryQuery extends Pagination {
  q?: string;
  city?: string;
}

export async function listPublicOrganizations(query: PublicDirectoryQuery) {
  const { skip, take } = paginationToSkipTake(query);

  const where = {
    status: "ACTIVE" as const,
    ...(query.city ? { city: { equals: query.city, mode: "insensitive" as const } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { category: { contains: query.q, mode: "insensitive" as const } },
            { city: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await db.$transaction([
    db.organization.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        address: true,
        city: true,
        country: true,
        branches: {
          where: { status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            queues: {
              where: { status: { in: ["OPEN", "PAUSED"] } },
              orderBy: { name: "asc" },
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    }),
    db.organization.count({ where }),
  ]);

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getPublicOrganization(organizationId: string) {
  const organization = await db.organization.findFirst({
    where: { id: organizationId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      address: true,
      city: true,
      country: true,
      phone: true,
      email: true,
      branches: {
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          queues: {
            orderBy: { name: "asc" },
            select: { id: true, name: true, description: true, status: true },
          },
        },
      },
    },
  });

  if (!organization) throw AppError.notFound("Organization not found");
  return organization;
}
