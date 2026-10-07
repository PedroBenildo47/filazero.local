/** Shared result returned by every notification channel provider. */
export interface ProviderResult {
  /** Stable provider identifier stored on the delivery row (e.g. `whatsapp-cloud`). */
  provider: string;
  /** Provider message id when the gateway returns one, for later reconciliation. */
  messageId: string | null;
}
