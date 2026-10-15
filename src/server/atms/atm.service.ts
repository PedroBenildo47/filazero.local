/**
 * ATM network (Multicaixa) — location and cash status.
 *
 * Public reads are unauthenticated (citizens checking which ATM has cash).
 * Writes are layered by trust:
 *   - `COMMUNITY` reports are open (rate-limited), informational;
 *   - `MANAGER`/`ADMIN` updates come from an authenticated staff/operator;
 *   - `FEED` is reserved for a future EMIS/aggregator integration.
 *
 * Nothing here invents data: an ATM only exists because an operator registered
 * it, and its status is whatever the most recent report said.
 */
import "server-only";
import type { Atm, AtmReportSource, AtmStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPlatformAdmin, type AuthContext } from "@/server/context";
import type {
  AtmQuery,
  AtmReportInput,
  CreateAtmInput,
  UpdateAtmInput,
} from "./atm.schemas";

/** A status report is considered fresh for this long. */
export const ATM_FRESHNESS_MS = 6 * 60 * 60 * 1000;

export interface AtmView {
  id: string;
  bank: string;
  label: string | null;
  address: string;
  city: string;
  province: string | null;
  latitude: number;
  longitude: number;
  /** Effective status (UNKNOWN when the last report is stale). */
  status: AtmStatus;
  reportedStatus: AtmStatus;
  cashLevel: number | null;
  notes: string | null;
  active: boolean;
  fresh: boolean;
  lastReportedAt: string;
}

export function serializeAtm(atm: Atm): AtmView {
  const fresh = Date.now() - atm.lastReportedAt.getTime() <= ATM_FRESHNESS_MS;
  return {
    id: atm.id,
    bank: atm.bank,
    label: atm.label,
    address: atm.address,
    city: atm.city,
    province: atm.province,
    latitude: atm.latitude,
    longitude: atm.longitude,
    status: fresh ? atm.status : "UNKNOWN",
    reportedStatus: atm.status,
    cashLevel: atm.cashLevel,
    notes: atm.notes,
    active: atm.active,
    fresh,
    lastReportedAt: atm.lastReportedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Public reads                                                                */
/* -------------------------------------------------------------------------- */

export async function listPublicAtms(query: AtmQuery) {
  const { skip, take } = paginationToSkipTake(query);
  const where = {
    active: true,
    ...(query.city ? { city: { equals: query.city, mode: "insensitive" as const } } : {}),
    ...(query.bank ? { bank: { equals: query.bank, mode: "insensitive" as const } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { bank: { contains: query.q, mode: "insensitive" as const } },
            { label: { contains: query.q, mode: "insensitive" as const } },
            { address: { contains: query.q, mode: "insensitive" as const } },
            { city: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total, cities, banks] = await db.$transaction([
    db.atm.findMany({
      where,
      orderBy: [{ status: "asc" }, { bank: "asc" }, { city: "asc" }],
      skip,
      take,
    }),
    db.atm.count({ where }),
    db.atm.findMany({
      where: { active: true },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    }),
    db.atm.findMany({
      where: { active: true },
      distinct: ["bank"],
      select: { bank: true },
      orderBy: { bank: "asc" },
    }),
  ]);

  return {
    items: items.map(serializeAtm),
    total,
    page: query.page,
    pageSize: query.pageSize,
    cities: cities.map((row) => row.city),
    banks: banks.map((row) => row.bank),
  };
}

export async function getPublicAtm(atmId: string) {
  const atm = await db.atm.findFirst({ where: { id: atmId, active: true } });
  if (!atm) throw AppError.notFound("ATM not found");

  const reports = await db.atmReport.findMany({
    where: { atmId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      note: true,
      source: true,
      reporterName: true,
      createdAt: true,
    },
  });

  return {
    ...serializeAtm(atm),
    reports: reports.map((report) => ({
      id: report.id,
      status: report.status,
      note: report.note,
      source: report.source,
      reporterName: report.reporterName,
      createdAt: report.createdAt.toISOString(),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Reports (community / manager)                                               */
/* -------------------------------------------------------------------------- */

interface ReportContext {
  source: AtmReportSource;
  userId: string | null;
  displayName: string | null;
}

async function applyReport(
  atmId: string,
  input: AtmReportInput,
  context: ReportContext,
  meta: RequestMeta,
) {
  const atm = await db.atm.findFirst({ where: { id: atmId, active: true } });
  if (!atm) throw AppError.notFound("ATM not found");

  const now = new Date();
  const [report] = await db.$transaction([
    db.atmReport.create({
      data: {
        atmId,
        status: input.status,
        note: input.note ?? null,
        source: context.source,
        reporterUserId: context.userId,
        reporterName: context.displayName,
      },
    }),
    db.atm.update({
      where: { id: atmId },
      data: { status: input.status, lastReportedAt: now },
    }),
  ]);

  await recordAudit(db, {
    actorUserId: context.userId,
    action: "atm.status_reported",
    entityType: "atm",
    entityId: atmId,
    metadata: { status: input.status, source: context.source, reportId: report.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return serializeAtm({ ...atm, status: input.status, lastReportedAt: now });
}

/** Anonymous community report (rate-limited by the route). */
export async function submitCommunityReport(
  atmId: string,
  input: AtmReportInput,
  meta: RequestMeta,
) {
  return applyReport(
    atmId,
    input,
    { source: "COMMUNITY", userId: null, displayName: input.reporterName ?? null },
    meta,
  );
}

/** Authenticated staff/manager report (customers use the community route). */
export async function submitStaffReport(
  ctx: AuthContext,
  atmId: string,
  input: AtmReportInput,
  meta: RequestMeta,
) {
  if (ctx.user.role === "CUSTOMER") {
    throw AppError.forbidden("Only staff, managers or administrators can update an ATM.");
  }
  const source: AtmReportSource =
    ctx.user.role === "ADMINISTRATOR" ? "ADMIN" : "MANAGER";
  return applyReport(
    atmId,
    input,
    { source, userId: ctx.user.id, displayName: ctx.user.name },
    meta,
  );
}

/* -------------------------------------------------------------------------- */
/* Platform administration                                                     */
/* -------------------------------------------------------------------------- */

export async function createAtm(
  ctx: AuthContext,
  input: CreateAtmInput,
  meta: RequestMeta,
) {
  assertPlatformAdmin(ctx);
  const atm = await db.atm.create({
    data: {
      bank: input.bank,
      label: input.label ?? null,
      address: input.address,
      city: input.city,
      province: input.province ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      status: input.status,
      cashLevel: input.cashLevel ?? null,
      notes: input.notes ?? null,
      lastReportedAt: new Date(),
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "atm.created",
    entityType: "atm",
    entityId: atm.id,
    description: `${atm.bank} · ${atm.city}`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return serializeAtm(atm);
}

export async function listAdminAtms(ctx: AuthContext, query: AtmQuery) {
  assertPlatformAdmin(ctx);
  const { skip, take } = paginationToSkipTake(query);
  const [items, total] = await db.$transaction([
    db.atm.findMany({ orderBy: { createdAt: "desc" }, skip, take }),
    db.atm.count(),
  ]);
  return {
    items: items.map(serializeAtm),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function updateAtm(
  ctx: AuthContext,
  atmId: string,
  input: UpdateAtmInput,
  meta: RequestMeta,
) {
  assertPlatformAdmin(ctx);
  const existing = await db.atm.findUnique({ where: { id: atmId }, select: { id: true } });
  if (!existing) throw AppError.notFound("ATM not found");

  const atm = await db.atm.update({
    where: { id: atmId },
    data: {
      ...(input.bank === undefined ? {} : { bank: input.bank }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.province === undefined ? {} : { province: input.province }),
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
      ...(input.cashLevel === undefined ? {} : { cashLevel: input.cashLevel }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.status === undefined
        ? {}
        : { status: input.status, lastReportedAt: new Date() }),
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "atm.updated",
    entityType: "atm",
    entityId: atmId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return serializeAtm(atm);
}

export async function deleteAtm(ctx: AuthContext, atmId: string, meta: RequestMeta) {
  assertPlatformAdmin(ctx);
  const existing = await db.atm.findUnique({ where: { id: atmId }, select: { id: true, bank: true } });
  if (!existing) throw AppError.notFound("ATM not found");

  await db.atm.delete({ where: { id: atmId } });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "atm.deleted",
    entityType: "atm",
    entityId: atmId,
    description: existing.bank,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { id: atmId, deleted: true };
}
