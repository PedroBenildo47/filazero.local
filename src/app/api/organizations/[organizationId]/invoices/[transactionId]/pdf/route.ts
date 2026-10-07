import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getInvoicePdf } from "@/server/billing/invoice.service";

type Context = { params: Promise<{ organizationId: string; transactionId: string }> };

/** Fiscal invoice PDF (AGT layout) for a confirmed payment. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, transactionId } = await context.params;
  const { bytes, fileName } = await getInvoicePdf(auth, organizationId, transactionId);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
    },
  });
});
