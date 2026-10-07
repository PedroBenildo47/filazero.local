/**
 * Meta WhatsApp Cloud API driver.
 *
 * `POST {WHATSAPP_API_BASE}/{version}/{phone_number_id}/messages` with a bearer
 * token and a `text` message. The base URL is configurable so the HTTP test
 * suite can point it at a local sink instead of the real Graph API.
 */
import "server-only";
import { getEnv, isWhatsAppConfigured } from "@/lib/env";
import {
  buildWhatsAppRequest,
  extractProviderMessageId,
  normalizePhone,
} from "./notification-messages";
import type { ProviderResult } from "./provider-result";

export async function sendWhatsApp(to: string, message: string): Promise<ProviderResult> {
  if (!isWhatsAppConfigured()) throw new Error("WhatsApp Cloud API is not configured");

  const env = getEnv();
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Recipient has no valid phone number");

  const request = buildWhatsAppRequest({
    baseUrl: env.WHATSAPP_API_BASE,
    version: env.WHATSAPP_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
    token: env.WHATSAPP_ACCESS_TOKEN!,
    to: phone,
    message,
  });

  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`WhatsApp API responded ${response.status}: ${text.slice(0, 200)}`);
  }

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { provider: "whatsapp-cloud", messageId: extractProviderMessageId(payload) };
}
