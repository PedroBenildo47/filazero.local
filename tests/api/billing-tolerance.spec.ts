/**
 * HTTP suite: checkout tolerance.
 *
 * Proves the rule that matters for production: the QR and bank-transfer
 * checkouts **always** return `201` with a `PENDING` transaction — never a
 * `503` — regardless of whether `BILLING_BANK_IBAN` is configured, blank or
 * invalid. It also asserts the Banco BIC name fallback and that a degraded
 * checkout still carries a payable reference and readable instructions.
 *
 * The scenario is inferred from the server's own environment (the suite process
 * shares it with the server when launched by `scripts/run-billing-tolerance-tests.sh`).
 */
import { db } from "@/lib/db";
import { isValidAngolaIban, toAngolaIban, verifyEmvCoChecksum } from "@/server/billing/qr-payment";
import { BIC_BANK_DEFAULTS } from "@/server/billing/bank-profiles";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

interface BankDetailsDto {
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  holder: string;
  configured: boolean;
}

interface CheckoutDto {
  reference: string;
  instructions: string | null;
  qrPayload: string | null;
  bankDetails: BankDetailsDto | null;
  transaction: { id: string; status: string; method: string; provider: string };
}

export async function runBillingToleranceSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);

  /* ---------------- scenario detected from the server env --------------- */

  const rawIban = (process.env.BILLING_BANK_IBAN ?? "").trim();
  const ibanIsBlank = rawIban === "";
  const ibanIsValid = ibanIsBlank ? true : isValidAngolaIban(rawIban);
  // Blank → the real BIC default is used (QR works). Present but invalid → the
  // checkout degrades to transfer instructions instead of substituting another
  // account.
  const expectQr = ibanIsValid;
  const expectedIban = ibanIsBlank ? toAngolaIban(BIC_BANK_DEFAULTS.bban) : toAngolaIban(rawIban);
  const scenario = ibanIsBlank ? "blank-iban" : ibanIsValid ? "valid-iban" : "invalid-iban";

  const capabilities = await anonymous.get<{ qr: boolean; bankTransfer: boolean; bankConfigured: boolean }>(
    "/api/billing/capabilities",
  );
  reporter.equal("tolerance: the capabilities endpoint is public", capabilities.status, 200);
  reporter.equal(
    `tolerance[${scenario}]: the QR capability matches the configured IBAN`,
    capabilities.data?.qr,
    expectQr,
  );

  /* ------------------------------ fixtures ------------------------------ */

  const admin = await createAdmin(baseUrl, "tolerance-admin");
  const organization = await admin.client.post<{ id: string }>("/api/organizations", {
    name: `Tolerance ${Date.now()}`,
    city: "Luanda",
  });
  if (organization.status !== 201) {
    throw new Error(`could not create organization: ${JSON.stringify(organization.error)}`);
  }
  const organizationId = organization.data!.id;

  const managerUser = await createUser(baseUrl, "tolerance-manager", "ManagerPass123!");
  await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
  await db.organizationMember.create({
    data: { userId: managerUser.userId, organizationId, role: "MANAGER" },
  });
  const manager = await loginUser(baseUrl, managerUser.email, "ManagerPass123!");

  const plans = await anonymous.get<{ items: { id: string; code: string; priceCents: number }[] }>(
    "/api/plans",
  );
  const paidPlan = plans.data!.items.find((plan) => plan.priceCents > 0)!;

  /* -------------------------- QR_CODE checkout -------------------------- */

  const qr = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
    organizationId,
    planId: paidPlan.id,
    method: "QR_CODE",
  });

  reporter.check(
    `tolerance[${scenario}]: QR_CODE checkout returns 201 (never 503)`,
    qr.status === 201,
    `HTTP ${qr.status}${qr.error ? ` / ${qr.error.code}` : ""}`,
  );
  reporter.equal(
    `tolerance[${scenario}]: QR_CODE transaction is PENDING`,
    qr.data?.transaction.status,
    "PENDING",
  );
  reporter.check(
    `tolerance[${scenario}]: QR_CODE returns a payable reference`,
    typeof qr.data?.reference === "string" && qr.data!.reference.startsWith("FZ-"),
    qr.data?.reference,
  );

  if (expectQr) {
    reporter.check(
      `tolerance[${scenario}]: QR_CODE returns a valid EMVCo payload`,
      typeof qr.data?.qrPayload === "string" && verifyEmvCoChecksum(qr.data!.qrPayload!),
      (qr.data?.qrPayload ?? "").slice(-8),
    );
    reporter.check(
      `tolerance[${scenario}]: the QR encodes the canonical Angolan IBAN`,
      (qr.data?.qrPayload ?? "").includes(expectedIban),
      expectedIban,
    );
  } else {
    reporter.check(
      `tolerance[${scenario}]: QR_CODE degrades to a null payload (no QR)`,
      qr.data?.qrPayload === null,
      String(qr.data?.qrPayload),
    );
    reporter.check(
      `tolerance[${scenario}]: the degraded checkout still carries instructions`,
      typeof qr.data?.instructions === "string" && qr.data!.instructions!.length > 0,
    );
  }

  /* ------------------------- BANK_TRANSFER checkout --------------------- */

  const transfer = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
    organizationId,
    planId: paidPlan.id,
    method: "BANK_TRANSFER",
  });

  reporter.check(
    `tolerance[${scenario}]: BANK_TRANSFER checkout returns 201 (never 503)`,
    transfer.status === 201,
    `HTTP ${transfer.status}${transfer.error ? ` / ${transfer.error.code}` : ""}`,
  );
  reporter.equal(
    `tolerance[${scenario}]: BANK_TRANSFER transaction is PENDING`,
    transfer.data?.transaction.status,
    "PENDING",
  );
  reporter.check(
    `tolerance[${scenario}]: BANK_TRANSFER returns the reference inside the instructions`,
    typeof transfer.data?.instructions === "string" &&
      transfer.data!.instructions!.includes(transfer.data!.reference),
  );

  /* --------------------------- bank details ----------------------------- */

  const bank = transfer.data?.bankDetails;
  reporter.check(
    `tolerance[${scenario}]: bank details are always returned`,
    bank !== null && bank !== undefined,
  );
  reporter.check(
    `tolerance[${scenario}]: the bank name is never empty (BIC fallback)`,
    typeof bank?.bankName === "string" && bank.bankName.length > 0,
    bank?.bankName ?? "(null)",
  );
  reporter.equal(
    `tolerance[${scenario}]: the account number comes from the BIC default`,
    bank?.accountNumber,
    BIC_BANK_DEFAULTS.accountNumber,
  );
  reporter.check(
    `tolerance[${scenario}]: the holder is never empty`,
    typeof bank?.holder === "string" && bank.holder.length > 0,
    bank?.holder,
  );
  reporter.equal(
    `tolerance[${scenario}]: the resolved IBAN matches the configured/default account`,
    bank?.iban,
    expectQr ? expectedIban : null,
  );

  // Explicit "never 503" assertion across both methods.
  reporter.check(
    `tolerance[${scenario}]: neither method ever answers 503`,
    qr.status !== 503 && transfer.status !== 503,
    `qr=${qr.status} transfer=${transfer.status}`,
  );

  // Both transactions are persisted as PENDING (never faked as paid).
  for (const result of [qr, transfer]) {
    const row = await db.transaction.findUnique({ where: { reference: result.data!.reference } });
    reporter.equal(
      `tolerance[${scenario}]: ${result.data!.transaction.method} is persisted PENDING`,
      row?.status,
      "PENDING",
    );
  }
}
