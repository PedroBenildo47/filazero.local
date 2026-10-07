/**
 * Server-side analytics report PDF.
 *
 * Draws a real, multi-section A4 document with `pdf-lib` (the same pure-JS
 * dependency used by the AGT invoice): identification header, KPI grid, branch
 * and queue performance tables, status distribution, an hourly bar chart and a
 * daily-volume chart, with automatic page breaks and page numbers.
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OrganizationAnalyticsReport } from "./analytics.schemas";
import {
  formatRateBps,
  type AnalyticsReportLabels,
  type AnalyticsReportMeta,
} from "./analytics-export";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.88, 0.9, 0.94);
const ACCENT = rgb(0.31, 0.27, 0.9);
const SOFT = rgb(0.96, 0.97, 0.99);

interface Fonts {
  font: PDFFont;
  bold: PDFFont;
}

interface Doc {
  pdf: PDFDocument;
  page: PDFPage;
  fonts: Fonts;
  y: number;
  pageNumber: number;
}

function shortDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Luanda",
  }).format(date);
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeZone: "Africa/Luanda",
  }).format(date);
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} min ${remainder} s`;
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

function footer(doc: Doc): void {
  doc.page.drawText(
    "Processado por computador · FilaZero — gestão de filas presenciais",
    { x: MARGIN, y: MARGIN - 14, size: 8, font: doc.fonts.font, color: MUTED },
  );
  drawRight(doc.page, String(doc.pageNumber), doc.fonts.bold, 8, MARGIN - 14, MUTED);
}

async function newPage(doc: Doc): Promise<void> {
  footer(doc);
  doc.page = doc.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  doc.pageNumber += 1;
  doc.y = PAGE_HEIGHT - MARGIN;
}

async function ensureSpace(doc: Doc, needed: number): Promise<void> {
  if (doc.y - needed < MARGIN + 24) await newPage(doc);
}

function sectionTitle(doc: Doc, text: string): void {
  doc.page.drawText(text, { x: MARGIN, y: doc.y, size: 12, font: doc.fonts.bold, color: ACCENT });
  doc.y -= 8;
  doc.page.drawLine({
    start: { x: MARGIN, y: doc.y },
    end: { x: PAGE_WIDTH - MARGIN, y: doc.y },
    thickness: 1,
    color: LINE,
  });
  doc.y -= 18;
}

async function drawTable(
  doc: Doc,
  headers: string[],
  widths: number[],
  rows: Array<Array<string | number>>,
  aligns: Array<"left" | "right">,
): Promise<void> {
  const headerSize = 8;
  const headerLines = headers.map((header, index) =>
    wrapHeader(doc.fonts.bold, header, headerSize, (widths[index] ?? 0) - 6),
  );
  const headerLinesMax = Math.max(1, ...headerLines.map((lines) => lines.length));
  const headerHeight = headerLinesMax * 10 + 6;

  const drawHeader = () => {
    const top = doc.y;
    doc.page.drawRectangle({
      x: MARGIN,
      y: top - headerHeight,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: SOFT,
    });
    let x = MARGIN + 4;
    headers.forEach((header, index) => {
      const width = widths[index] ?? 0;
      const align = aligns[index] ?? "left";
      const lines = headerLines[index] ?? [header];
      lines.forEach((line, lineIndex) => {
        const textWidth = doc.fonts.bold.widthOfTextAtSize(line, headerSize);
        doc.page.drawText(line, {
          x: align === "right" ? x + width - textWidth : x,
          y: top - 10 - lineIndex * 10,
          size: headerSize,
          font: doc.fonts.bold,
          color: INK,
        });
      });
      x += width;
    });
    doc.y = top - headerHeight - 4;
  };

  await ensureSpace(doc, headerHeight + 20);
  drawHeader();

  for (const cells of rows) {
    if (doc.y - 16 < MARGIN + 24) {
      await newPage(doc);
      drawHeader();
    }
    let x = MARGIN + 4;
    cells.forEach((cell, index) => {
      const width = widths[index] ?? 0;
      const align = aligns[index] ?? "left";
      const text = String(cell);
      const clipped = clip(doc.fonts.font, text, 9, width - 6);
      if (align === "right") {
        const textWidth = doc.fonts.font.widthOfTextAtSize(clipped, 9);
        doc.page.drawText(clipped, {
          x: x + width - textWidth,
          y: doc.y,
          size: 9,
          font: doc.fonts.font,
          color: INK,
        });
      } else {
        doc.page.drawText(clipped, { x, y: doc.y, size: 9, font: doc.fonts.font, color: INK });
      }
      x += width;
    });
    doc.y -= 15;
  }
  doc.y -= 14;
}

function clip(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

/** Splits a table header across up to two lines so narrow columns stay readable. */
function wrapHeader(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2).map((line) => clip(font, line, size, maxWidth));
}

function drawKpi(
  doc: Doc,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
): void {
  doc.page.drawRectangle({ x, y: y - 46, width, height: 46, color: SOFT });
  doc.page.drawText(clip(doc.fonts.font, label, 8, width - 12), {
    x: x + 8,
    y: y - 15,
    size: 8,
    font: doc.fonts.font,
    color: MUTED,
  });
  doc.page.drawText(clip(doc.fonts.bold, value, 15, width - 12), {
    x: x + 8,
    y: y - 34,
    size: 15,
    font: doc.fonts.bold,
    color: INK,
  });
}

function drawBarChart(
  doc: Doc,
  points: Array<{ label: string; value: number }>,
  labelEvery: number,
): void {
  const height = 150;
  const top = doc.y;
  const base = top - height + 22;
  const plotLeft = MARGIN;
  const plotWidth = CONTENT_WIDTH;
  const maximum = Math.max(1, ...points.map((point) => point.value));
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(1.5, Math.min(20, slot * 0.6));

  doc.page.drawLine({
    start: { x: plotLeft, y: base },
    end: { x: plotLeft + plotWidth, y: base },
    thickness: 1,
    color: LINE,
  });

  points.forEach((point, index) => {
    if (point.value > 0) {
      const barHeight = (point.value / maximum) * (height - 30);
      doc.page.drawRectangle({
        x: plotLeft + index * slot + (slot - barWidth) / 2,
        y: base,
        width: barWidth,
        height: barHeight,
        color: ACCENT,
      });
    }
    if (index % labelEvery === 0 || index === points.length - 1) {
      doc.page.drawText(point.label, {
        x: plotLeft + index * slot + slot / 2 - 8,
        y: base - 12,
        size: 7,
        font: doc.fonts.font,
        color: MUTED,
      });
    }
  });

  doc.y = base - 26;
}

export async function renderAnalyticsPdf(
  report: OrganizationAnalyticsReport,
  meta: AnalyticsReportMeta,
  labels: AnalyticsReportLabels,
  title: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("FilaZero");
  pdf.setSubject(title);
  pdf.setProducer("FilaZero");

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts: Fonts = {
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const doc: Doc = { pdf, page, fonts, y: PAGE_HEIGHT - MARGIN, pageNumber: 1 };

  // ---- Header -----------------------------------------------------------
  page.drawText("FilaZero", { x: MARGIN, y: doc.y, size: 20, font: fonts.bold, color: ACCENT });
  drawRight(page, title, fonts.bold, 13, doc.y + 4);
  doc.y -= 22;
  page.drawText(meta.organizationName, { x: MARGIN, y: doc.y, size: 12, font: fonts.bold });
  doc.y -= 15;
  const metaLines = [
    `${labels.periodFrom}: ${shortDate(report.period.from)}`,
    `${labels.periodTo}: ${shortDate(report.period.to)}`,
    `${labels.timezone}: ${report.period.timezone}`,
    `${labels.generatedAt}: ${shortDateTime(meta.generatedAt)}`,
  ];
  for (const line of metaLines) {
    page.drawText(line, { x: MARGIN, y: doc.y, size: 9, font: fonts.font, color: MUTED });
    doc.y -= 12;
  }
  doc.y -= 6;

  // ---- KPI grid (3 x 2) -------------------------------------------------
  const gap = 12;
  const kpiWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const totals = report.totals;
  const kpis: Array<[string, string]> = [
    [labels.issuedTickets, String(totals.issuedTickets)],
    [labels.completedTickets, String(totals.completedTickets)],
    [labels.completionRate, formatRateBps(totals.completionRateBps)],
    [labels.cancelledTickets, String(totals.cancelledTickets)],
    [labels.noShowTickets, String(totals.noShowTickets)],
    [labels.averageWait, duration(totals.averageWaitSeconds)],
  ];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const index = row * 3 + column;
      const kpi = kpis[index];
      if (!kpi) continue;
      drawKpi(doc, MARGIN + column * (kpiWidth + gap), doc.y, kpiWidth, kpi[0], kpi[1]);
    }
    doc.y -= 58;
  }
  doc.y -= 6;

  // ---- Peak -------------------------------------------------------------
  if (report.peak.busiestDay || report.peak.busiestHour) {
    sectionTitle(doc, labels.peak);
    const peakLines: string[] = [];
    if (report.peak.busiestDay) {
      peakLines.push(
        `${labels.busiestDay}: ${shortDate(report.peak.busiestDay.date)} (${report.peak.busiestDay.count})`,
      );
    }
    if (report.peak.busiestHour) {
      peakLines.push(
        `${labels.busiestHour}: ${String(report.peak.busiestHour.hour).padStart(2, "0")}h (${report.peak.busiestHour.count})`,
      );
    }
    for (const line of peakLines) {
      page.drawText(line, { x: MARGIN, y: doc.y, size: 10, font: fonts.font, color: INK });
      doc.y -= 15;
    }
    doc.y -= 6;
  }

  // ---- Branch performance ----------------------------------------------
  await ensureSpace(doc, 60);
  sectionTitle(doc, labels.branchPerformance);
  await drawTable(
    doc,
    [labels.branch, labels.completed, labels.averageWaitSeconds, labels.averageServiceSeconds],
    [CONTENT_WIDTH - 240, 80, 80, 80],
    report.branchPerformance.map((entry) => [
      entry.branchName,
      entry.completedTickets,
      entry.averageWaitSeconds ?? "—",
      entry.averageServiceSeconds ?? "—",
    ]),
    ["left", "right", "right", "right"],
  );

  // ---- Queue performance ------------------------------------------------
  await ensureSpace(doc, 60);
  sectionTitle(doc, labels.queuePerformance);
  await drawTable(
    doc,
    [
      labels.branch,
      labels.queue,
      labels.completed,
      labels.averageWaitSeconds,
      labels.averageServiceSeconds,
    ],
    [CONTENT_WIDTH - 360, 130, 80, 75, 75],
    report.queuePerformance.map((entry) => [
      entry.branchName,
      entry.queueName,
      entry.completedTickets,
      entry.averageWaitSeconds ?? "—",
      entry.averageServiceSeconds ?? "—",
    ]),
    ["left", "left", "right", "right", "right"],
  );

  // ---- Status distribution ---------------------------------------------
  await ensureSpace(doc, 60);
  sectionTitle(doc, labels.statusDistribution);
  await drawTable(
    doc,
    [labels.status, labels.tickets],
    [CONTENT_WIDTH - 80, 80],
    report.statusDistribution.map((entry) => [
      labels.statusLabels[entry.status],
      entry.count,
    ]),
    ["left", "right"],
  );

  // ---- Hourly distribution ---------------------------------------------
  await ensureSpace(doc, 200);
  sectionTitle(doc, labels.hourly);
  drawBarChart(
    doc,
    report.completedByHour.map((entry) => ({
      label: `${String(entry.hour).padStart(2, "0")}h`,
      value: entry.count,
    })),
    2,
  );

  // ---- Daily volume -----------------------------------------------------
  await ensureSpace(doc, 200);
  sectionTitle(doc, labels.daily);
  drawBarChart(
    doc,
    report.issuedByDay.map((entry) => ({ label: entry.date.slice(5), value: entry.count })),
    Math.max(1, Math.ceil(report.issuedByDay.length / 12)),
  );

  footer(doc);
  return pdf.save();
}
