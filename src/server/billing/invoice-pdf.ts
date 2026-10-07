/**
 * Fiscal invoice PDF (AGT layout).
 *
 * Draws a self-contained A4 document with every field the AGT expects: issuer
 * and customer identification (NIF), the official series/number, the VAT
 * breakdown, the payment details, the integrity hash and a QR code carrying the
 * verifiable payload. `pdf-lib` and `qrcode` are pure-JS, so this runs in the
 * Next.js server runtime without native dependencies.
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import {
  INVOICE_DOCUMENT_LABELS,
  formatVatRate,
  type InvoiceDocumentTypeName,
} from "./agt";

export interface InvoicePdfInput {
  issuer: {
    name: string;
    taxId: string | null;
    address: string | null;
    city: string | null;
  };
  customer: {
    name: string;
    taxId: string | null;
    address: string | null;
    city: string | null;
  };
  document: {
    documentType: InvoiceDocumentTypeName;
    invoiceNumber: string;
    issuedAt: Date;
    currency: string;
    subtotalCents: number;
    vatCents: number;
    vatRateBps: number;
    totalCents: number;
    planName: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    methodLabel: string;
    reference: string;
    paidAt: Date | null;
    hash: string;
    qrPayload: string;
    agtCertified: boolean;
  };
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.88, 0.9, 0.94);
const ACCENT = rgb(0.31, 0.27, 0.9);

function money(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function shortDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeZone: "Africa/Luanda",
  }).format(date);
}

function period(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  return `${shortDate(start)} — ${shortDate(end)}`;
}

function drawRight(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  color = INK,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: PAGE_WIDTH - MARGIN - width, y, size, font, color });
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fatura ${input.document.invoiceNumber}`);
  pdf.setAuthor(input.issuer.name);
  pdf.setSubject("Fatura FilaZero");
  pdf.setProducer("FilaZero");

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const label = INVOICE_DOCUMENT_LABELS[input.document.documentType].pt.toUpperCase();
  let y = PAGE_HEIGHT - MARGIN;

  // ---- Header: issuer (left) and document identity (right) --------------
  page.drawText(input.issuer.name, { x: MARGIN, y, size: 20, font: bold, color: ACCENT });
  drawRight(page, label, bold, 14, y + 4);
  y -= 20;
  const issuerLines = [
    input.issuer.taxId ? `NIF: ${input.issuer.taxId}` : "NIF: —",
    input.issuer.address ?? "",
    input.issuer.city ?? "",
  ].filter(Boolean);
  for (const line of issuerLines) {
    page.drawText(line, { x: MARGIN, y, size: 10, font, color: MUTED });
    y -= 13;
  }
  // Document meta, right aligned, on the same vertical band as the issuer lines.
  let metaY = PAGE_HEIGHT - MARGIN - 20;
  const meta: Array<[string, string]> = [
    ["Número", input.document.invoiceNumber],
    ["Data", shortDate(input.document.issuedAt)],
    ["Série", input.document.invoiceNumber.split("/")[0] ?? ""],
  ];
  for (const [key, value] of meta) {
    drawRight(page, `${key}: ${value}`, font, 10, metaY, MUTED);
    metaY -= 13;
  }

  y = Math.min(y, metaY) - 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 26;

  // ---- Customer ---------------------------------------------------------
  page.drawText("Cliente", { x: MARGIN, y, size: 11, font: bold });
  y -= 16;
  const customerLines = [
    input.customer.name,
    input.customer.taxId ? `NIF: ${input.customer.taxId}` : "NIF: —",
    [input.customer.address, input.customer.city].filter(Boolean).join(", "),
  ].filter(Boolean);
  for (const line of customerLines) {
    page.drawText(line, { x: MARGIN, y, size: 10, font, color: INK });
    y -= 13;
  }
  y -= 14;

  // ---- Line items -------------------------------------------------------
  page.drawRectangle({
    x: MARGIN,
    y: y - 6,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 22,
    color: rgb(0.96, 0.97, 0.99),
  });
  page.drawText("Descrição", { x: MARGIN + 6, y, size: 10, font: bold });
  page.drawText("Período", { x: MARGIN + 250, y, size: 10, font: bold });
  drawRight(page, "Valor", bold, 10, y);
  y -= 24;
  page.drawText(input.document.planName, { x: MARGIN + 6, y, size: 10, font });
  page.drawText(period(input.document.periodStart, input.document.periodEnd), {
    x: MARGIN + 250,
    y,
    size: 10,
    font,
  });
  drawRight(page, money(input.document.subtotalCents, input.document.currency), font, 10, y);
  y -= 10;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 24;

  // ---- Totals -----------------------------------------------------------
  const totals: Array<[string, string, boolean]> = [
    ["Base tributável", money(input.document.subtotalCents, input.document.currency), false],
    [
      `IVA (${formatVatRate(input.document.vatRateBps)})`,
      money(input.document.vatCents, input.document.currency),
      false,
    ],
    ["Total", money(input.document.totalCents, input.document.currency), true],
  ];
  for (const [key, value, strong] of totals) {
    const size = strong ? 12 : 10;
    const usedFont = strong ? bold : font;
    page.drawText(key, { x: PAGE_WIDTH - MARGIN - 220, y, size, font: usedFont });
    drawRight(page, value, usedFont, size, y);
    y -= strong ? 20 : 15;
  }
  y -= 8;

  // ---- Payment details --------------------------------------------------
  page.drawText("Pagamento", { x: MARGIN, y, size: 11, font: bold });
  y -= 16;
  const payment: Array<[string, string]> = [
    ["Método", input.document.methodLabel],
    ["Referência", input.document.reference],
    ["Pago em", shortDate(input.document.paidAt)],
  ];
  for (const [key, value] of payment) {
    page.drawText(`${key}: ${value}`, { x: MARGIN, y, size: 10, font, color: MUTED });
    y -= 13;
  }

  // ---- QR code + hash ---------------------------------------------------
  const qrDataUrl = await QRCode.toDataURL(input.document.qrPayload, {
    margin: 1,
    width: 260,
    errorCorrectionLevel: "M",
  });
  const qrImage = await pdf.embedPng(qrDataUrl);
  const qrSize = 96;
  page.drawImage(qrImage, { x: MARGIN, y: MARGIN + 30, width: qrSize, height: qrSize });

  const hashX = MARGIN + qrSize + 16;
  let hashY = MARGIN + 30 + qrSize - 12;
  page.drawText("Assinatura (hash)", { x: hashX, y: hashY, size: 9, font: bold });
  hashY -= 12;
  for (const chunk of input.document.hash.match(/.{1,56}/g) ?? []) {
    page.drawText(chunk, { x: hashX, y: hashY, size: 8, font, color: MUTED });
    hashY -= 10;
  }
  hashY -= 6;
  page.drawText(
    input.document.agtCertified
      ? "Documento assinado com certificado de software."
      : "Documento com hash de integridade (sem certificado AGT configurado).",
    { x: hashX, y: hashY, size: 8, font, color: MUTED },
  );

  page.drawText(
    "Processado por computador · FilaZero — gestão de filas presenciais",
    { x: MARGIN, y: MARGIN - 12, size: 8, font, color: MUTED },
  );

  return pdf.save();
}
