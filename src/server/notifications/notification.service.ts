/**
 * Notifications (real, persisted rows).
 *
 * Every notification is written inside the same transaction as the state change
 * that produced it, so a notification can never describe an event that did not
 * happen. External delivery channels (email/SMS/push) are intentionally out of
 * scope for this phase — see docs/ARCHITECTURE.md.
 */
import "server-only";
import type { NotificationType } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { publicNotification } from "@/server/serializers";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  ticketId?: string | null;
}

/** Writes a notification. Accepts a transaction client so it stays atomic. */
export async function createNotification(
  client: DbClient,
  input: CreateNotificationInput,
): Promise<void> {
  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 160),
      message: input.message,
      ticketId: input.ticketId ?? null,
    },
  });
}

export async function listNotifications(userId: string, pagination: Pagination) {
  const { skip, take } = paginationToSkipTake(pagination);
  const [items, total, unread] = await db.$transaction([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.notification.count({ where: { userId } }),
    db.notification.count({ where: { userId, read: false } }),
  ]);

  return {
    items: items.map(publicNotification),
    total,
    unread,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<void> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
  if (result.count === 0) {
    throw AppError.notFound("Notification not found");
  }
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return result.count;
}
