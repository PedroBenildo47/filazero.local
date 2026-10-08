/**
 * Angolan bank QR — EMVCo Merchant-Presented Mode (MPM).
 *
 * Pure module (no I/O, no `server-only`), so payload construction and checksum
 * verification are unit-testable. It encodes a payable QR that a banking app
 * (Multicaixa Express / home-banking) can scan to pre-fill a bank transfer.
 *
 * Structure follows the EMV QR Code Specification for Payment Systems
 * (Merchant-Presented Mode): a left-to-right sequence of Tag-Length-Value
 * elements terminated by the mandatory Tag 63 CRC.
 *
 *   - Tag 00  Payload Format Indicator ("01")
 *   - Tag 01  Point of Initiation Method ("11" static / "12" dynamic)
 *   - Tag 26  Merchant Account Information (domestic template):
 *              00 GUI (acquirer/bank identifier)
 *              01 account key (IBAN)
 *              02 payment reference
 *   - Tag 52  Merchant Category Code
 *   - Tag 53  Transaction Currency (ISO 4217 numeric; AOA = 973)
 *   - Tag 54  Transaction Amount (present for dynamic codes only)
 *   - Tag 58  Country Code ("AO")
 *   - Tag 59  Merchant Name
 *   - Tag 60  Merchant City
 *   - Tag 62  Additional Data Field Template (01 Bill Number / 05 Reference)
 *   - Tag 63  CRC-16/CCITT-FALSE over every preceding element, including "6304"
 *
 * The domestic sub-tag mapping inside Tag 26 is scheme-specific; the layout
 * above mirrors the widely-adopted `00 GUI / 01 key / 02 additional` shape and
 * must be confirmed with the acquiring bank before enabling QR_CODE in
 * production. The container framing and CRC are fully standards-correct.
 */

/** EMVCo Payload Format Indicator: always "01". */
export const EMVCO_PAYLOAD_FORMAT_INDICATOR = "01";

/** ISO 4217 numeric code for the Angolan Kwanza. */
export const AOA_CURRENCY_CODE = "973";

/** ISO 3166-1 alpha-2 country code for Angola. */
export const ANGOLA_COUNTRY_CODE = "AO";

/** First tag of the domestic Merchant Account Information range (26–51). */
export const DOMESTIC_MERCHANT_TAG = "26";

/** Tag 63 is always the last element and is 4 hex characters long. */
const CRC_TAG = "63";
const CRC_LENGTH = "04";

/* -------------------------------------------------------------------------- */
/* CRC-16/CCITT-FALSE                                                          */
/* -------------------------------------------------------------------------- */

/**
 * CRC-16/CCITT-FALSE as mandated by EMVCo: polynomial `0x1021`, initial value
 * `0xFFFF`, no input/output reflection and no final XOR. Returns the 4-digit
 * upper-case hexadecimal representation used by Tag 63.
 */
export function crc16ccitt(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/* -------------------------------------------------------------------------- */
/* TLV encoding                                                                */
/* -------------------------------------------------------------------------- */

/** One encoded Tag-Length-Value element. */
export interface TlvElement {
  tag: string;
  length: number;
  value: string;
}

/**
 * Encodes a single TLV element. The length is the UTF-8 byte length (so
 * accented merchant names are measured correctly) and must fit in two digits.
 */
export function tlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) {
    throw new Error(`Invalid TLV tag: ${tag}`);
  }
  const length = new TextEncoder().encode(value).length;
  if (length > 99) {
    throw new Error(`TLV value for tag ${tag} exceeds 99 bytes`);
  }
  return `${tag}${String(length).padStart(2, "0")}${value}`;
}

/**
 * Parses a flat TLV string into its elements. Throws when a tag/length pair is
 * truncated or a declared length runs past the end of the payload.
 */
export function parseTlv(payload: string): TlvElement[] {
  // Lengths are UTF-8 byte counts, so the cursor must move over bytes — not
  // UTF-16 code units — otherwise multi-byte values (accented names) misalign.
  const bytes = new TextEncoder().encode(payload);
  const decoder = new TextDecoder();
  const elements: TlvElement[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (cursor + 4 > bytes.length) {
      throw new Error("Truncated TLV header");
    }
    const header = decoder.decode(bytes.subarray(cursor, cursor + 4));
    const tag = header.slice(0, 2);
    const lengthText = header.slice(2, 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) {
      throw new Error(`Malformed TLV header at offset ${cursor}`);
    }
    const length = Number(lengthText);
    const start = cursor + 4;
    const end = start + length;
    if (end > bytes.length) {
      throw new Error(`TLV tag ${tag} declares ${length} bytes past the payload end`);
    }
    elements.push({ tag, length, value: decoder.decode(bytes.subarray(start, end)) });
    cursor = end;
  }
  return elements;
}

/** Recomputes and compares the trailing Tag 63 checksum. */
export function verifyEmvCoChecksum(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const expected = crc16ccitt(body);
  return payload.slice(-4).toUpperCase() === expected;
}

/* -------------------------------------------------------------------------- */
/* IBAN (Angola)                                                               */
/* -------------------------------------------------------------------------- */

/** Removes separators and upper-cases an IBAN. */
export function normalizeIban(iban: string): string {
  return iban.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Validates an Angolan IBAN: `AO` + 2 check digits + 21 digits (25 chars), with
 * the ISO 13616 mod-97 check digit verification.
 */
export function isValidAngolaIban(iban: string): boolean {
  const normalized = normalizeIban(iban);
  if (!/^AO\d{23}$/.test(normalized)) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  // mod-97 without BigInt: fold the digit string in chunks.
  let remainder = 0;
  for (const character of digits) {
    remainder = (remainder * 10 + Number(character)) % 97;
  }
  return remainder === 1;
}

/* -------------------------------------------------------------------------- */
/* Payload construction                                                        */
/* -------------------------------------------------------------------------- */

export interface AngolaBankQrInput {
  /** Beneficiary IBAN (Angola). Required: the QR must identify the account. */
  iban: string;
  /** Merchant/beneficiary display name (Tag 59). */
  merchantName: string;
  /** Merchant city (Tag 60). */
  merchantCity?: string | null;
  /** Amount in the smallest unit; omit for a static, payer-entered amount. */
  amountCents?: number | null;
  /** Payment reference quoted by the payer (also encoded in Tags 26 and 62). */
  reference: string;
  /** Acquirer GUI inside the domestic template (Tag 26 sub-tag 00). */
  acquirerGui?: string | null;
  /** ISO 18245 merchant category code; "0000" when not applicable. */
  merchantCategoryCode?: string | null;
}

/** `123456` → `"1234.56"` (EMVCo amounts carry an explicit decimal point). */
export function formatQrAmount(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("QR amount must be a non-negative integer of cents");
  }
  return (amountCents / 100).toFixed(2);
}

function assertQrInput(input: AngolaBankQrInput): void {
  if (!isValidAngolaIban(input.iban)) {
    throw new Error("A valid Angolan IBAN is required to build the bank QR");
  }
  if (!input.merchantName.trim()) {
    throw new Error("A merchant name is required to build the bank QR");
  }
  if (!input.reference.trim()) {
    throw new Error("A payment reference is required to build the bank QR");
  }
  if (input.amountCents !== null && input.amountCents !== undefined) {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
      throw new Error("QR amount must be a non-negative integer of cents");
    }
  }
}

/**
 * Builds a dynamic EMVCo Merchant-Presented payload for an Angolan bank
 * transfer, ending with the computed Tag 63 CRC.
 */
export function buildAngolaBankQr(input: AngolaBankQrInput): string {
  assertQrInput(input);

  const iban = normalizeIban(input.iban);
  const dynamic = input.amountCents !== null && input.amountCents !== undefined;

  const domestic = [
    input.acquirerGui ? tlv("00", input.acquirerGui) : "",
    tlv("01", iban),
    tlv("02", input.reference),
  ].join("");

  const additional = [
    tlv("01", input.reference),
    tlv("05", input.reference),
  ].join("");

  const body = [
    tlv("00", EMVCO_PAYLOAD_FORMAT_INDICATOR),
    tlv("01", dynamic ? "12" : "11"),
    tlv(DOMESTIC_MERCHANT_TAG, domestic),
    tlv("52", input.merchantCategoryCode ?? "0000"),
    tlv("53", AOA_CURRENCY_CODE),
    dynamic ? tlv("54", formatQrAmount(input.amountCents as number)) : "",
    tlv("58", ANGOLA_COUNTRY_CODE),
    tlv("59", input.merchantName.trim().slice(0, 25)),
    tlv("60", (input.merchantCity ?? "Luanda").trim().slice(0, 15)),
    tlv("62", additional),
  ].join("");

  return `${body}${CRC_TAG}${CRC_LENGTH}${crc16ccitt(`${body}${CRC_TAG}${CRC_LENGTH}`)}`;
}
