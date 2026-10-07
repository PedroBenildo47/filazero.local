/**
 * Invoice signing.
 *
 * With an AGT software certificate configured (`AGT_PRIVATE_KEY`) the canonical
 * string is signed with RSA-SHA256 and the document is marked `agtCertified`.
 * Without it, a deterministic HMAC-SHA256 over the same canonical string is
 * produced — this gives integrity and verifiability, but it is **not** an AGT
 * signature, and the document is stored with `agtCertified = false` so nothing
 * pretends otherwise.
 */
import "server-only";
import { createHmac, createSign } from "node:crypto";
import { getEnv } from "@/lib/env";

export interface InvoiceSignature {
  hash: string;
  certified: boolean;
}

export function signInvoice(canonical: string): InvoiceSignature {
  const env = getEnv();

  if (env.AGT_PRIVATE_KEY) {
    const signer = createSign("RSA-SHA256");
    signer.update(canonical, "utf8");
    signer.end();
    const signature = signer.sign(env.AGT_PRIVATE_KEY);
    return { hash: signature.toString("base64"), certified: true };
  }

  const secret =
    env.AGT_HASH_SECRET ?? env.PAYMENT_WEBHOOK_SECRET ?? "filazero-invoice-integrity";
  const hash = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return { hash, certified: false };
}
