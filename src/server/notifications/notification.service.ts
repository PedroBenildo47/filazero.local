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
import { isSmsConfigured, isWhatsAppConfigured } from "@/lib/env";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { publicNotification } from "@/server/serializers";
import { enqueueNotificationDeliveries } from "./notification-dispatch.service";
import { isOutOfAppType, normalizePhone } from "./notification-messages";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  ticketId?: string | null;
}

/**
 * Writes a notification. Accepts a transaction client so it stays atomic with
 * the state change that produced it.
 *
 * For events worth an out-of-app message it also queues the SMS/WhatsApp
 * delivery rows in the same transaction; the actual send happens after commit
 * (see `notification-dispatch.service.ts`), so the external channel can never
 * announce an event that rolled back.
 */
export async function createNotification(
  client: DbClient,
  input: CreateNotificationInput,
): Promise<{ id: string }> {
  const notification = await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 160),
      message: input.message,
      ticketId: input.ticketId ?? null,
    },
    select: { id: true },
  });

  if (isOutOfAppType(input.type)) {
    const user = await client.user.findUnique({
      where: { id: input.userId },
      select: { phone: true, smsOptIn: true, whatsappOptIn: true },
    });
    if (user) {
      await enqueueNotificationDeliveries(client, {
        notificationId: notification.id,
        userId: input.userId,
        recipient: {
          phone: user.phone,
          smsOptIn: user.smsOptIn,
          whatsappOptIn: user.whatsappOptIn,
        },
      });
    }
  }

  return notification;
}

/* -------------------------------------------------------------------------- */
/* Out-of-app preferences                                                      */
/* -------------------------------------------------------------------------- */

export async function getNotificationPreferences(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, smsOptIn: true, whatsappOptIn: true },
  });
  if (!user) throw AppError.notFound("User not found");
  return {
    phone: user.phone,
    smsOptIn: user.smsOptIn,
    whatsappOptIn: user.whatsappOptIn,
    smsConfigured: isSmsConfigured(),
    whatsappConfigured: isWhatsAppConfigured(),
  };
}

export interface UpdateNotificationPreferencesInput {
  phone?: string | null;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
}

export async function updateNotificationPreferences(
  userId: string,
  input: UpdateNotificationPreferencesInput,
) {
  const data: {
    phone?: string | null;
    smsOptIn?: boolean;
    whatsappOptIn?: boolean;
  } = {};

  if (input.phone !== undefined) {
    if (input.phone === null || input.phone.trim() === "") {
      data.phone = null;
    } else {
      const normalized = normalizePhone(input.phone);
      if (!normalized) throw AppError.validation("Invalid phone number");
      data.phone = normalized;
    }
  }
  if (input.smsOptIn !== undefined) data.smsOptIn = input.smsOptIn;
  if (input.whatsappOptIn !== undefined) data.whatsappOptIn = input.whatsappOptIn;

  await db.user.update({ where: { id: userId }, data });
  return getNotificationPreferences(userId);
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
