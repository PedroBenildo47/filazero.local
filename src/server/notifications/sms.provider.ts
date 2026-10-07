/**
 * Generic HTTP SMS gateway.
 *
 * The contract is deliberately simple and documented in `.env.example`:
 * `POST <SMS_API_URL>` with `Authorization: Bearer <SMS_API_TOKEN>` and JSON
 * `{ to, message, sender }`. When the gateway is not configured the caller must
 * not attempt delivery — `sendSms` throws rather than pretending to succeed.
 */
import "server-only";
import { getEnv, isSmsConfigured } from "@/lib/env";
import { buildSmsRequest, extractProviderMessageId, normalizePhone } from "./notification-messages";
import type { ProviderResult } from "./provider-result";

export async function sendSms(to: string, message: string): Promise<ProviderResult> {
  if (!isSmsConfigured()) throw new Error("SMS gateway is not configured");

  const env = getEnv();
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Recipient has no valid phone number");

  const request = buildSmsRequest({
    url: env.SMS_API_URL!,
    token: env.SMS_API_TOKEN!,
    sender: env.SMS_SENDER_ID,
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
    throw new Error(`SMS gateway responded ${response.status}: ${text.slice(0, 200)}`);
  }

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { provider: "sms-http", messageId: extractProviderMessageId(payload) };
}
