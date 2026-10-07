import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUEUE_CODE_ALPHABET,
  generateQueueCode,
  isQueueCode,
  isUuid,
} from "@/server/queues/queue-code";

test("generateQueueCode returns codes of the requested length", () => {
  assert.equal(generateQueueCode().length, 8);
  assert.equal(generateQueueCode(6).length, 6);
  assert.equal(generateQueueCode(12).length, 12);
});

test("generateQueueCode only uses unambiguous characters", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateQueueCode();
    for (const character of code) {
      assert.ok(
        QUEUE_CODE_ALPHABET.includes(character),
        `unexpected character ${character} in ${code}`,
      );
    }
    assert.ok(!/[IO01]/.test(code), `ambiguous character in ${code}`);
  }
});

test("generateQueueCode produces distinct codes", () => {
  const codes = new Set(Array.from({ length: 500 }, () => generateQueueCode()));
  // 32^8 possibilities — 500 draws should never collide.
  assert.equal(codes.size, 500);
});

test("isUuid recognises UUIDs only", () => {
  assert.equal(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
  assert.equal(isUuid("  3F2504E0-4F89-41D3-9A0C-0305E82C3301  "), true);
  assert.equal(isUuid("7F3A9C2B"), false);
  assert.equal(isUuid("not-a-uuid"), false);
});

test("isQueueCode accepts codes case-insensitively and rejects junk", () => {
  assert.equal(isQueueCode("7F3A9C2B"), true);
  assert.equal(isQueueCode("7f3a9c2b"), true);
  assert.equal(isQueueCode("ABCDEF"), true);
  assert.equal(isQueueCode("ABC"), false);
  assert.equal(isQueueCode("TOOLONGCODE12"), false);
  assert.equal(isQueueCode("has-dash"), false);
});
