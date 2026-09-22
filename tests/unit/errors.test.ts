import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, isAppError } from "@/lib/errors";

test("each error code maps to the expected HTTP status", () => {
  const cases: Array<[AppError, number]> = [
    [AppError.badRequest("x"), 400],
    [AppError.validation("x"), 422],
    [AppError.unauthenticated(), 401],
    [AppError.sessionExpired(), 401],
    [AppError.forbidden(), 403],
    [AppError.notFound(), 404],
    [AppError.conflict("x"), 409],
    [AppError.queueClosed(), 409],
    [AppError.invalidState("x"), 409],
    [AppError.internal(), 500],
  ];
  for (const [error, status] of cases) {
    assert.equal(error.status, status, error.code);
  }
});

test("error codes are the stable identifiers used by the client", () => {
  assert.equal(AppError.unauthenticated().code, "UNAUTHENTICATED");
  assert.equal(AppError.forbidden().code, "FORBIDDEN");
  assert.equal(AppError.notFound().code, "NOT_FOUND");
  assert.equal(AppError.conflict("x").code, "CONFLICT");
  assert.equal(AppError.queueClosed().code, "QUEUE_CLOSED");
  assert.equal(AppError.invalidState("x").code, "INVALID_STATE");
  assert.equal(AppError.internal().code, "INTERNAL");
});

test("AppError is an Error and is recognised by isAppError", () => {
  const error = AppError.notFound("Ticket not found");
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Ticket not found");
  assert.equal(isAppError(error), true);
});

test("isAppError rejects foreign errors", () => {
  assert.equal(isAppError(new Error("boom")), false);
  assert.equal(isAppError("boom"), false);
  assert.equal(isAppError(null), false);
});

test("default messages are human readable and never expose internals", () => {
  assert.match(AppError.forbidden().message, /permission/i);
  assert.match(AppError.unauthenticated().message, /authentication/i);
  assert.doesNotMatch(AppError.internal().message, /stack|sql|prisma/i);
});

test("details are optional and preserved when provided", () => {
  const error = AppError.validation("Invalid", { field: "email" });
  assert.deepEqual(error.details, { field: "email" });
  assert.equal(AppError.notFound().details, undefined);
});
