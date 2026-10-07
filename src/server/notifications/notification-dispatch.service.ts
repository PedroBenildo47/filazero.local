/**
 * Out-of-app notification dispatcher (SMS / WhatsApp).
 *
 * Delivery is modelled as an outbox: `enqueueNotificationDeliveries` writes
 * PENDING rows inside the same transaction as the notification, so a message
 * can never describe an event that did not commit. `drainPendingDeliveries`
 * then claims rows with `FOR UPDATE SKIP LOCKED` (safe with several instances)
 * and hands each one to its provider.
 *
 * A channel whose provider is not configured is recorded as SKIPPED rather than
 * silently "sent" — the delivery history is an honest record of what happened.
 */
import "server-only";
import { Prisma, type NotificationChannel, type NotificationType } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { getEnv, isSmsConfigured, isWhatsAppConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import {
  buildChannelMessage,
  normalizePhone,
  selectChannels,
  type ChannelRecipient,
} from "./notification-messages";
import type { ProviderResult } from "./provider-result";
import { sendSms } from "./sms.provider";
import { sendWhatsApp } from "./whatsapp.provider";

const MAX_ATTEMPTS = 3;
const CLAIM_BATCH = 20;

export interface EnqueueInput {
  notificationId: string;
  userId: string;
  recipient: ChannelRecipient;
}

/**
 * Writes one PENDING delivery row per consented channel. Idempotent through the
 * `(notification_id, channel)` unique index, so replaying an event never sends
 * the same message twice.
 */
export async function enqueueNotificationDeliveries(
  client: DbClient,
  input: EnqueueInput,
): Promise<number> {
  const channels = selectChannels(input.recipient);
  if (channels.length === 0) return 0;
  const phone = normalizePhone(input.recipient.phone);
  if (!phone) return 0;

  const result = await client.notificationDelivery.createMany({
    data: channels.map((channel) => ({
      notificationId: input.notificationId,
      userId: input.userId,
      channel,
      recipient: phone,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

interface ClaimedDelivery {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  attempts: number;
  type: NotificationType;
  title: string;
  message: string;
}

/** Atomically claims PENDING rows and returns them with their notification. */
async function claimPending(limit: number): Promise<ClaimedDelivery[]> {
  return db.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
    UPDATE notification_deliveries AS d
    SET status = 'PROCESSING', attempts = d.attempts + 1, updated_at = NOW()
    FROM notifications AS n
    WHERE n.id = d.notification_id
      AND d.id IN (
        SELECT id FROM notification_deliveries
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
    RETURNING d.id,
              d.channel,
              d.recipient,
              d.attempts,
              n.type   AS "type",
              n.title  AS "title",
              n.message AS "message"
  `);
}

function channelConfigured(channel: NotificationChannel): boolean {
  return channel === "WHATSAPP" ? isWhatsAppConfigured() : isSmsConfigured();
}

async function sendViaChannel(
  channel: NotificationChannel,
  to: string,
  message: string,
): Promise<ProviderResult> {
  return channel === "WHATSAPP" ? sendWhatsApp(to, message) : sendSms(to, message);
}

/** Sends one claimed delivery and records the outcome. */
async function deliver(row: ClaimedDelivery): Promise<boolean> {
  if (!channelConfigured(row.channel)) {
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: "SKIPPED",
        error: `${row.channel} provider is not configured`,
      },
    });
    return false;
  }

  const message = buildChannelMessage(row.channel, {
    type: row.type,
    title: row.title,
    message: row.message,
    appUrl: getEnv().APP_URL,
  });

  try {
    const result = await sendViaChannel(row.channel, row.recipient, message);
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        provider: result.provider,
        providerMessageId: result.messageId,
        error: null,
        sentAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const terminal = row.attempts >= MAX_ATTEMPTS;
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: terminal ? "FAILED" : "PENDING",
        error: message.slice(0, 500),
      },
    });
    logger.error(
      { err: error, deliveryId: row.id, channel: row.channel, terminal },
      "notification delivery failed",
    );
    return false;
  }
}

/** Claims and sends up to `limit` pending deliveries. Returns how many were sent. */
export async function drainPendingDeliveries(limit = CLAIM_BATCH): Promise<number> {
  const rows = await claimPending(limit);
  let sent = 0;
  for (const row of rows) {
    if (await deliver(row)) sent += 1;
  }
  return sent;
}

/**
 * Fire-and-forget drain, used right after a queue transaction commits. It never
 * throws: a delivery problem must not fail the request that triggered it.
 */
export function scheduleNotificationDrain(): void {
  void drainPendingDeliveries().catch((error) => {
    logger.error({ err: error }, "notification drain failed");
  });
}

/** Delivery history for one user (their own notifications only). */
export async function listNotificationDeliveries(
  userId: string,
  pagination: Pagination,
) {
  const { skip, take } = paginationToSkipTake(pagination);
  const [items, total] = await db.$transaction([
    db.notificationDelivery.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { notification: { select: { type: true, title: true } } },
    }),
    db.notificationDelivery.count({ where: { userId } }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      recipient: item.recipient,
      provider: item.provider,
      attempts: item.attempts,
      error: item.error,
      sentAt: item.sentAt,
      createdAt: item.createdAt,
      notification: item.notification,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}
