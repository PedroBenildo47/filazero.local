/**
 * Unit tests for the pure analytics export formatter: CSV escaping, BOM/CRLF,
 * spreadsheet formula-injection neutralisation, section layout, null handling
 * and file-name derivation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsReportFileName,
  buildAnalyticsCsv,
  formatRateBps,
  type AnalyticsReportLabels,
} from "@/server/organizations/analytics-export";
import type { OrganizationAnalyticsReport } from "@/server/organizations/analytics.schemas";

const labels: AnalyticsReportLabels = {
  organization: "Organização",
  periodFrom: "Desde",
  periodTo: "Até",
  timezone: "Fuso horário",
  generatedAt: "Gerado em",
  summary: "Resumo",
  metric: "Métrica",
  value: "Valor",
  issuedTickets: "Senhas emitidas",
  completedTickets: "Atendimentos concluídos",
  cancelledTickets: "Canceladas",
  noShowTickets: "Não compareceu",
  waitingTickets: "À espera",
  completionRate: "Taxa de conclusão",
  cancellationRate: "Taxa de cancelamento",
  noShowRate: "Taxa de não comparência",
  averageWait: "Espera média",
  averageService: "Atendimento médio",
  peak: "Picos",
  busiestDay: "Dia de maior procura",
  busiestHour: "Hora de maior procura",
  daily: "Por dia",
  date: "Data",
  tickets: "Senhas emitidas",
  weekly: "Por semana",
  weekStart: "Início da semana",
  queuePerformance: "Tempos por fila",
  branchPerformance: "Tempos por filial",
  branch: "Filial",
  queue: "Fila",
  completed: "Atendidas",
  averageWaitSeconds: "Espera média",
  averageServiceSeconds: "Atendimento médio",
  statusDistribution: "Distribuição por estado",
  status: "Estado",
  statusLabels: {
    WAITING: "À espera",
    CALLED: "Chamada",
    SERVING: "Em atendimento",
    COMPLETED: "Concluída",
    CANCELLED: "Cancelada",
    NO_SHOW: "Não compareceu",
  },
  hourly: "Atendimentos concluídos por hora",
  hour: "Hora",
};

function report(overrides: Partial<OrganizationAnalyticsReport> = {}): OrganizationAnalyticsReport {
  return {
    period: {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      timezone: "Africa/Luanda",
    },
    totals: {
      issuedTickets: 10,
      completedTickets: 8,
      cancelledTickets: 1,
      noShowTickets: 1,
      waitingTickets: 0,
      completionRateBps: 8000,
      cancellationRateBps: 1000,
      noShowRateBps: 1000,
      averageWaitSeconds: 450,
      averageServiceSeconds: 750,
    },
    issuedByDay: [{ date: "2026-01-02", count: 4 }],
    issuedByWeek: [{ weekStart: "2025-12-29", count: 10 }],
    queuePerformance: [
      {
        queueId: "q1",
        queueName: "Caixa",
        branchId: "b1",
        branchName: "Luanda",
        completedTickets: 8,
        averageWaitSeconds: 450,
        averageServiceSeconds: 750,
      },
    ],
    branchPerformance: [
      {
        branchId: "b1",
        branchName: "Luanda",
        completedTickets: 8,
        averageWaitSeconds: 450,
        averageServiceSeconds: 750,
      },
      {
        branchId: "b2",
        branchName: "Benguela",
        completedTickets: 0,
        averageWaitSeconds: null,
        averageServiceSeconds: null,
      },
    ],
    statusDistribution: [
      { status: "WAITING", count: 0 },
      { status: "CALLED", count: 0 },
      { status: "SERVING", count: 0 },
      { status: "COMPLETED", count: 8 },
      { status: "CANCELLED", count: 1 },
      { status: "NO_SHOW", count: 1 },
    ],
    completedByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 9 ? 5 : 0,
    })),
    peak: {
      busiestDay: { date: "2026-01-02", count: 4 },
      busiestHour: { hour: 9, count: 5 },
    },
    ...overrides,
  };
}

const meta = { organizationName: "Farmácia Central", generatedAt: new Date("2026-02-01T10:00:00.000Z") };

test("formatRateBps renders basis points as a two-decimal percentage", () => {
  assert.equal(formatRateBps(0), "0.00%");
  assert.equal(formatRateBps(1400), "14.00%");
  assert.equal(formatRateBps(8000), "80.00%");
  assert.equal(formatRateBps(10000), "100.00%");
  assert.equal(formatRateBps(1234), "12.34%");
});

test("CSV starts with a UTF-8 BOM and uses CRLF line endings", () => {
  const csv = buildAnalyticsCsv(report(), meta, labels);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.includes("\r\n"), true);
  assert.equal(csv.endsWith("\r\n"), true);
});

test("CSV carries the identification block and the KPI summary", () => {
  const csv = buildAnalyticsCsv(report(), meta, labels);
  assert.match(csv, /"Organização","Farmácia Central"/);
  assert.match(csv, /"Senhas emitidas","10"/);
  assert.match(csv, /"Atendimentos concluídos","8"/);
  assert.match(csv, /"Taxa de conclusão","80\.00%"/);
  assert.match(csv, /"Espera média","450"/);
  assert.match(csv, /"Gerado em","2026-02-01T10:00:00\.000Z"/);
});

test("CSV lists every status label, including the ones with zero count", () => {
  const csv = buildAnalyticsCsv(report(), meta, labels);
  for (const statusLabel of Object.values(labels.statusLabels)) {
    assert.equal(csv.includes(`"${statusLabel}"`), true, `missing ${statusLabel}`);
  }
});

test("null durations are exported as empty cells", () => {
  const csv = buildAnalyticsCsv(report(), meta, labels);
  assert.match(csv, /"Tempos por filial","Benguela","0","",""/);
});

test("quotes are doubled and formula injection is neutralised", () => {
  const csv = buildAnalyticsCsv(
    report(),
    { organizationName: '=cmd("x")', generatedAt: meta.generatedAt },
    labels,
  );
  assert.equal(csv.includes(`"'=cmd(""x"")"`), true);
});

test("analyticsReportFileName slugifies the organization and dates the file", () => {
  assert.equal(
    analyticsReportFileName(meta, report(), "csv"),
    "filazero-analytics-farmacia-central-2026-01-01_2026-01-31.csv",
  );
  assert.equal(
    analyticsReportFileName(
      { organizationName: "Águas & Sais, Lda.", generatedAt: meta.generatedAt },
      report(),
      "pdf",
    ),
    "filazero-analytics-aguas-sais-lda-2026-01-01_2026-01-31.pdf",
  );
});
