/**
 * Minimal SMTP sink for the HTTP test suite.
 *
 * A real SMTP conversation on localhost: the application is configured with
 * `SMTP_HOST=127.0.0.1 SMTP_PORT=2525`, so the tests verify that a password
 * reset email is genuinely delivered (headers, recipient, body, link) instead
 * of asserting against a stub.
 */
import { createServer, type Server, type Socket } from "node:net";

export interface CapturedEmail {
  from: string;
  to: string[];
  raw: string;
}

/** Decodes quoted-printable so links survive line wrapping and `=3D`. */
export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/** Extracts a `?token=` value from an email body. */
export function extractResetToken(rawEmail: string): string | null {
  const decoded = decodeQuotedPrintable(rawEmail);
  const match = decoded.match(/token=([A-Za-z0-9_-]{16,})/);
  return match?.[1] ?? null;
}

export class SmtpSink {
  private server: Server | null = null;
  private readonly messages: CapturedEmail[] = [];
  private readonly waiters: Array<{
    address: string;
    resolve: (email: CapturedEmail) => void;
    timer: NodeJS.Timeout;
  }> = [];

  async start(port = 2525): Promise<void> {
    this.server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
    this.waiters.length = 0;
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  get received(): CapturedEmail[] {
    return [...this.messages];
  }

  waitForEmailTo(address: string, timeoutMs = 10_000): Promise<CapturedEmail> {
    const existing = this.messages.find((message) =>
      message.to.some((recipient) => recipient.toLowerCase() === address.toLowerCase()),
    );
    if (existing) return Promise.resolve(existing);

    return new Promise<CapturedEmail>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`No email delivered to ${address} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ address, resolve, timer });
    });
  }

  private deliver(email: CapturedEmail): void {
    this.messages.push(email);
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]!;
      if (email.to.some((r) => r.toLowerCase() === waiter.address.toLowerCase())) {
        clearTimeout(waiter.timer);
        this.waiters.splice(index, 1);
        waiter.resolve(email);
      }
    }
  }

  private handle(socket: Socket): void {
    let buffer = "";
    let inData = false;
    let data = "";
    let from = "";
    const to: string[] = [];

    const write = (line: string) => socket.write(`${line}\r\n`);

    write("220 filazero-test ESMTP ready");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      for (;;) {
        if (inData) {
          const terminator = buffer.indexOf("\r\n.\r\n");
          if (terminator === -1) {
            // Keep a small overlap so a split terminator is still detected.
            if (buffer.length > 4) {
              data += buffer.slice(0, -4);
              buffer = buffer.slice(-4);
            }
            return;
          }
          data += buffer.slice(0, terminator);
          buffer = buffer.slice(terminator + 5);
          inData = false;
          this.deliver({ from, to: [...to], raw: data });
          data = "";
          from = "";
          to.length = 0;
          write("250 2.0.0 Ok: queued");
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);

        const command = line.split(" ")[0]?.toUpperCase() ?? "";

        if (command === "EHLO" || command === "HELO") {
          // Deliberately no STARTTLS/AUTH so the client stays in clear text.
          write("250 filazero-test");
        } else if (command === "MAIL") {
          from = line.slice(line.indexOf(":") + 1).replace(/[<>]/g, "").trim();
          write("250 2.1.0 Ok");
        } else if (command === "RCPT") {
          to.push(line.slice(line.indexOf(":") + 1).replace(/[<>]/g, "").trim());
          write("250 2.1.5 Ok");
        } else if (command === "DATA") {
          inData = true;
          write("354 End data with <CR><LF>.<CR><LF>");
        } else if (command === "RSET") {
          from = "";
          to.length = 0;
          write("250 2.0.0 Ok");
        } else if (command === "NOOP") {
          write("250 2.0.0 Ok");
        } else if (command === "QUIT") {
          write("221 2.0.0 Bye");
          socket.end();
          return;
        } else {
          write("250 2.0.0 Ok");
        }
      }
    });

    socket.on("error", () => socket.destroy());
  }
}
