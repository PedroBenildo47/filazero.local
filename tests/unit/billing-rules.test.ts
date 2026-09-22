/**
 * Unit tests for the pure billing rules and email templates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@/lib/errors";
import { addInterval, normalizePaymentEvent } from "@/server/billing/billing.rules";
import {
  renderPasswordResetEmail,
  type EmailLang,
} from "@/server/email/templates";

/* ------------------------------ periods ---------------------------------- */

test("addInterval advances one month / one year in UTC", () => {
  const start = new Date("2026-01-15T10:00:00.000Z");
  assert.equal(addInterval(start, "MONTHLY").toISOString(), "2026-02-15T10:00:00.000Z");
  assert.equal(addInterval(start, "YEARLY").toISOString(), "2027-01-15T10:00:00.000Z");
  assert.equal(start.toISOString(), "2026-01-15T10:00:00.000Z", "input is not mutated");
});

test("addInterval rolls over the year", () => {
  assert.equal(
    addInterval(new Date("2026-12-10T00:00:00.000Z"), "MONTHLY").toISOString(),
    "2027-01-10T00:00:00.000Z",
  );
});

/* --------------------------- event parsing ------------------------------- */

test("normalises the FilaZero gateway payload", () => {
  const paidAt = "2026-03-01T09:30:00.000Z";
  const event = normalizePaymentEvent(
    JSON.stringify({
      id: "evt_abc",
      type: "payment.succeeded",
      data: { reference: "FZ-1234", providerReference: "bank-777", paidAt },
    }),
  );
  assert.equal(event.eventId, "evt_abc");
  assert.equal(event.outcome, "succeeded");
  assert.equal(event.reference, "FZ-1234");
  assert.equal(event.providerReference, "bank-777");
  assert.equal(event.provider, "INVOICE");
  assert.equal(event.paidAt.toISOString(), paidAt);
});

test("understands a failed gateway payload", () => {
  const event = normalizePaymentEvent(
    JSON.stringify({
      id: "evt_fail",
      type: "payment.failed",
      data: { reference: "FZ-1" },
    }),
  );
  assert.equal(event.outcome, "failed");
  assert.equal(event.provider, "INVOICE");
});

test("normalises a Stripe checkout.session.completed event", () => {
  const event = normalizePaymentEvent(
    JSON.stringify({
      id: "evt_stripe_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          client_reference_id: "FZ-STRIPE",
          payment_status: "paid",
        },
      },
    }),
  );
  assert.equal(event.provider, "STRIPE");
  assert.equal(event.outcome, "succeeded");
  assert.equal(event.reference, "FZ-STRIPE");
  assert.equal(event.providerReference, "cs_test_1");
});

test("a Stripe session that is not paid is treated as a failure", () => {
  const event = normalizePaymentEvent(
    JSON.stringify({
      id: "evt_stripe_2",
      type: "checkout.session.completed",
      data: {
        object: { id: "cs_2", client_reference_id: "FZ-2", payment_status: "unpaid" },
      },
    }),
  );
  assert.equal(event.outcome, "failed");
});

test("rejects malformed webhooks with a 400-level error", () => {
  const cases = [
    "not json",
    JSON.stringify({ type: "payment.succeeded", data: {} }),
    JSON.stringify({ id: "evt_1", type: "payment.succeeded", data: {} }),
    JSON.stringify({ id: "evt_1", type: "unknown.event", data: {} }),
    JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: {} },
    }),
  ];
  for (const body of cases) {
    assert.throws(
      () => normalizePaymentEvent(body),
      (error: unknown) => error instanceof AppError && error.status === 400,
      `should reject: ${body}`,
    );
  }
});

/* ------------------------------ templates -------------------------------- */

test("password reset template renders both languages", () => {
  const link = "https://filazero.test/redefinir-senha?token=abc123";
  for (const lang of ["pt", "en"] as EmailLang[]) {
    const email = renderPasswordResetEmail({
      name: "Ana",
      link,
      expiresInMinutes: 60,
      lang,
    });
    assert.ok(email.subject.length > 0);
    assert.ok(email.text.includes(link), "text part carries the link");
    assert.ok(email.html.includes(link), "html part carries the link");
    assert.ok(email.html.includes("Ana"), "greeting is personalised");
    assert.ok(email.text.includes("60"), "expiry is stated");
  }
  assert.notEqual(
    renderPasswordResetEmail({ name: "Ana", link, expiresInMinutes: 60, lang: "pt" })
      .subject,
    renderPasswordResetEmail({ name: "Ana", link, expiresInMinutes: 60, lang: "en" })
      .subject,
  );
});

test("the template escapes HTML in the user name", () => {
  const email = renderPasswordResetEmail({
    name: '<script>alert("x")</script>',
    link: "https://filazero.test/reset?token=abc",
    expiresInMinutes: 30,
    lang: "pt",
  });
  assert.ok(!email.html.includes("<script>"), "no raw script tag");
  assert.ok(email.html.includes("&lt;script&gt;"), "name is escaped");
});
