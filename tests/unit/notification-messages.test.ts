/**
 * Unit tests for the pure SMS/WhatsApp notification rules: phone normalisation,
 * consent-based channel selection, per-channel message bodies, provider request
 * builders and provider message-id extraction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelMessage,
  buildSmsRequest,
  buildWhatsAppRequest,
  extractProviderMessageId,
  isOutOfAppType,
  normalizePhone,
  selectChannels,
  toWhatsAppAddress,
} from "@/server/notifications/notification-messages";

test("normalizePhone accepts Angolan local, zero-prefixed and international forms", () => {
  assert.equal(normalizePhone("923 456 789"), "+244923456789");
  assert.equal(normalizePhone("0923 456 789"), "+244923456789");
  assert.equal(normalizePhone("244923456789"), "+244923456789");
  assert.equal(normalizePhone("+244 923 456 789"), "+244923456789");
  assert.equal(normalizePhone("+351 912 345 678"), "+351912345678");
});

test("normalizePhone rejects empty and implausible numbers", () => {
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("12345678901234567890"), null);
});

test("toWhatsAppAddress strips the leading plus", () => {
  assert.equal(toWhatsAppAddress("+244923456789"), "244923456789");
});

test("selectChannels only returns consented channels with a usable phone", () => {
  assert.deepEqual(
    selectChannels({ phone: "923456789", smsOptIn: false, whatsappOptIn: false }),
    [],
  );
  assert.deepEqual(
    selectChannels({ phone: null, smsOptIn: true, whatsappOptIn: true }),
    [],
  );
  assert.deepEqual(
    selectChannels({ phone: "923456789", smsOptIn: false, whatsappOptIn: true }),
    ["WHATSAPP"],
  );
  assert.deepEqual(
    selectChannels({ phone: "923456789", smsOptIn: true, whatsappOptIn: true }),
    ["WHATSAPP", "SMS"],
  );
});

test("isOutOfAppType keeps high-frequency events in-app only", () => {
  assert.equal(isOutOfAppType("CUSTOMER_CALLED"), true);
  assert.equal(isOutOfAppType("QUEUE_JOINED"), true);
  assert.equal(isOutOfAppType("TICKET_CANCELLED"), true);
  assert.equal(isOutOfAppType("SERVICE_COMPLETED"), true);
  assert.equal(isOutOfAppType("POSITION_CHANGED"), false);
  assert.equal(isOutOfAppType("SERVING_STARTED"), false);
  assert.equal(isOutOfAppType("QUEUE_STATUS_CHANGED"), false);
});

test("buildChannelMessage formats SMS and WhatsApp differently", () => {
  const input = {
    type: "CUSTOMER_CALLED" as const,
    title: "É a sua vez",
    message: "Dirija-se ao atendimento. Ticket nº 12.",
    appUrl: "https://app.filazero.example",
  };
  const sms = buildChannelMessage("SMS", input);
  assert.equal(
    sms,
    "FilaZero: É a sua vez — Dirija-se ao atendimento. Ticket nº 12. https://app.filazero.example/conta",
  );

  const whatsapp = buildChannelMessage("WHATSAPP", input);
  assert.ok(whatsapp.includes("*FilaZero — É a sua vez*"));
  assert.ok(whatsapp.includes("Dirija-se ao atendimento. Ticket nº 12."));
  assert.ok(whatsapp.includes("https://app.filazero.example/conta"));
});

test("buildChannelMessage omits the link when no app URL is given", () => {
  const sms = buildChannelMessage("SMS", {
    type: "QUEUE_JOINED",
    title: "Entrou na fila",
    message: "Posição 3.",
  });
  assert.equal(sms, "FilaZero: Entrou na fila — Posição 3.");
  assert.equal(sms.includes("http"), false);
});

test("buildSmsRequest targets the gateway with a bearer token", () => {
  const request = buildSmsRequest({
    url: "https://sms.example/send",
    token: "secret-token",
    sender: "FilaZero",
    to: "+244923456789",
    message: "Olá",
  });
  assert.equal(request.url, "https://sms.example/send");
  assert.equal(request.headers.authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(request.body), {
    to: "+244923456789",
    message: "Olá",
    sender: "FilaZero",
  });
});

test("buildWhatsAppRequest builds the Cloud API payload", () => {
  const request = buildWhatsAppRequest({
    baseUrl: "https://graph.facebook.com/",
    version: "v21.0",
    phoneNumberId: "123456",
    token: "wa-token",
    to: "+244923456789",
    message: "Olá",
  });
  assert.equal(
    request.url,
    "https://graph.facebook.com/v21.0/123456/messages",
  );
  assert.equal(request.headers.authorization, "Bearer wa-token");
  assert.deepEqual(JSON.parse(request.body), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "244923456789",
    type: "text",
    text: { preview_url: false, body: "Olá" },
  });
});

test("extractProviderMessageId copes with different provider shapes", () => {
  assert.equal(extractProviderMessageId({ id: "abc" }), "abc");
  assert.equal(extractProviderMessageId({ message_id: "m-1" }), "m-1");
  assert.equal(extractProviderMessageId({ sid: "SM123" }), "SM123");
  assert.equal(extractProviderMessageId({ messages: [{ id: "wamid.1" }] }), "wamid.1");
  assert.equal(extractProviderMessageId({ ok: true }), null);
  assert.equal(extractProviderMessageId(null), null);
  assert.equal(extractProviderMessageId("nope"), null);
});
