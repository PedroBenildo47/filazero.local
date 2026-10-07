/**
 * Pure SMS / WhatsApp notification rules.
 *
 * No I/O and no `server-only`: phone normalisation, channel selection, the
 * message body per channel and the exact HTTP request each provider expects are
 * all deterministic and unit-tested. The network calls live in the provider
 * modules (`sms.provider.ts`, `whatsapp.provider.ts`).
 */
import type { NotificationChannel, NotificationType } from "@prisma/client";

/** Order matters: WhatsApp is attempted first, SMS is the fallback channel. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "WHATSAPP",
  "SMS",
];

export interface ChannelRecipient {
  phone: string | null;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
}

/**
 * Channels a user can actually receive: only those they consented to and only
 * when a usable phone number is on file. An empty list means nothing is sent.
 */
export function selectChannels(user: ChannelRecipient): NotificationChannel[] {
  if (!normalizePhone(user.phone)) return [];
  const channels: NotificationChannel[] = [];
  if (user.whatsappOptIn) channels.push("WHATSAPP");
  if (user.smsOptIn) channels.push("SMS");
  return channels;
}

/**
 * Normalises a phone number to E.164, defaulting to Angola (+244). Accepts
 * local numbers (`923 456 789`), numbers with a leading zero (`0923...`), an
 * explicit country code (`244923...`) or an international `+` form. Returns
 * `null` when the result is not a plausible number (9–15 digits).
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode = "244",
): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 0) return null;

  if (!hadPlus) {
    digits = digits.replace(/^0+/, "");
    if (!digits.startsWith(defaultCountryCode) && digits.length <= 9) {
      digits = `${defaultCountryCode}${digits}`;
    }
  }

  if (digits.length < 9 || digits.length > 15) return null;
  return `+${digits}`;
}

/** WhatsApp expects the number without the leading `+`. */
export function toWhatsAppAddress(phone: string): string {
  return phone.replace(/^\+/, "");
}

/**
 * Events worth an out-of-app message. High-frequency or staff-facing events
 * (`POSITION_CHANGED`, `SERVING_STARTED`, `QUEUE_STATUS_CHANGED`) stay in-app
 * only, so a customer is never spammed for every step of the queue.
 */
const OUT_OF_APP_TYPES: readonly NotificationType[] = [
  "QUEUE_JOINED",
  "CUSTOMER_CALLED",
  "SERVICE_COMPLETED",
  "TICKET_CANCELLED",
];

export function isOutOfAppType(type: NotificationType): boolean {
  return OUT_OF_APP_TYPES.includes(type);
}

export interface ChannelMessageInput {
  type: NotificationType;
  title: string;
  message: string;
  /** Public app URL; when present a short link is appended to the message. */
  appUrl?: string;
}

/** Body sent over a channel. Kept short so it fits a single SMS segment. */
export function buildChannelMessage(
  channel: NotificationChannel,
  input: ChannelMessageInput,
): string {
  const link = input.appUrl ? `${input.appUrl.replace(/\/$/, "")}/conta` : null;
  if (channel === "WHATSAPP") {
    const lines = [`*FilaZero — ${input.title}*`, "", input.message];
    if (link) lines.push("", link);
    return lines.join("\n");
  }
  const suffix = link ? ` ${link}` : "";
  return `FilaZero: ${input.title} — ${input.message}${suffix}`;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface SmsRequestInput {
  url: string;
  token: string;
  sender: string;
  to: string;
  message: string;
}

/** Request for a generic JSON SMS gateway: `POST { to, message, sender }`. */
export function buildSmsRequest(input: SmsRequestInput): HttpRequest {
  return {
    url: input.url,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({ to: input.to, message: input.message, sender: input.sender }),
  };
}

export interface WhatsAppRequestInput {
  baseUrl: string;
  version: string;
  phoneNumberId: string;
  token: string;
  /** E.164 number; the leading `+` is stripped for the API. */
  to: string;
  message: string;
}

/** Request for the Meta WhatsApp Cloud API (`/messages`). */
export function buildWhatsAppRequest(input: WhatsAppRequestInput): HttpRequest {
  const base = input.baseUrl.replace(/\/$/, "");
  return {
    url: `${base}/${input.version}/${input.phoneNumberId}/messages`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWhatsAppAddress(input.to),
      type: "text",
      text: { preview_url: false, body: input.message },
    }),
  };
}

/**
 * Best-effort extraction of a provider message id from a JSON response, so the
 * delivery row can be reconciled later without assuming one provider's shape.
 */
export function extractProviderMessageId(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["id", "message_id", "messageId", "sid", "reference"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const messages = record.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const first = messages[0];
    if (first && typeof first === "object") {
      const id = (first as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  }
  return null;
}
