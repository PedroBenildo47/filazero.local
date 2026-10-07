/**
 * Minimal HTTP sink for the notification channel tests.
 *
 * A real HTTP server on localhost that accepts the exact requests the SMS
 * gateway and the WhatsApp Cloud API drivers send, so the suite verifies the
 * whole path — queue event → outbox → provider request → captured message —
 * instead of asserting against a stub. The application is started with
 * `SMS_API_URL` and `WHATSAPP_API_BASE` pointing here (see
 * `scripts/run-api-tests.sh`).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface CapturedSms {
  to: string;
  message: string;
  sender: string;
  authorization: string | null;
}

export interface CapturedWhatsApp {
  to: string;
  message: string;
  authorization: string | null;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

export class NotificationSink {
  private server: Server | null = null;
  private readonly smsMessages: CapturedSms[] = [];
  private readonly whatsappMessages: CapturedWhatsApp[] = [];
  private counter = 0;

  async start(port = 2526): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  get sms(): CapturedSms[] {
    return [...this.smsMessages];
  }

  get whatsapp(): CapturedWhatsApp[] {
    return [...this.whatsappMessages];
  }

  /** Polls until `predicate` is true or the timeout elapses. */
  async waitForCondition(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async waitForSmsTo(address: string, timeoutMs = 8000): Promise<CapturedSms | null> {
    return this.waitFor(
      () => this.smsMessages.find((message) => message.to === address) ?? null,
      timeoutMs,
    );
  }

  async waitForWhatsAppTo(address: string, timeoutMs = 8000): Promise<CapturedWhatsApp | null> {
    return this.waitFor(
      () => this.whatsappMessages.find((message) => message.to === address) ?? null,
      timeoutMs,
    );
  }

  private async waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = probe();
      if (found) return found;
      if (Date.now() > deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async handle(
    request: IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    const url = request.url ?? "/";
    const body = await readBody(request);
    const authorization = request.headers.authorization ?? null;
    const json = (payload: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    try {
      if (url.startsWith("/sms")) {
        const parsed = JSON.parse(body || "{}") as {
          to?: string;
          message?: string;
          sender?: string;
        };
        this.counter += 1;
        this.smsMessages.push({
          to: parsed.to ?? "",
          message: parsed.message ?? "",
          sender: parsed.sender ?? "",
          authorization,
        });
        json({ id: `sms-${this.counter}` });
        return;
      }

      if (url.includes("/messages")) {
        const parsed = JSON.parse(body || "{}") as {
          to?: string;
          text?: { body?: string };
        };
        this.counter += 1;
        this.whatsappMessages.push({
          to: parsed.to ?? "",
          message: parsed.text?.body ?? "",
          authorization,
        });
        json({ messages: [{ id: `wamid.${this.counter}` }] });
        return;
      }

      json({ error: "not found" }, 404);
    } catch {
      json({ error: "bad request" }, 400);
    }
  }
}
