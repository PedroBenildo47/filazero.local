/**
 * HTTP suite: real password-reset email delivery over SMTP.
 *
 * A real SMTP conversation is served on localhost; the application is started
 * with `SMTP_HOST`/`SMTP_PORT` pointing at it. The test therefore verifies the
 * whole path — request → template → SMTP → inbox → working link — instead of
 * asserting against a stub.
 */
import { ApiClient } from "./client";
import { SmtpSink, decodeQuotedPrintable, extractResetToken } from "./smtp-sink";
import {
  DEFAULT_PASSWORD,
  createUser,
  loginUser,
  type Reporter,
} from "./support";

export async function runEmailSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const port = Number(process.env.TEST_SMTP_PORT ?? 2525);

  const sink = new SmtpSink();
  await sink.start(port);

  try {
    const user = await createUser(baseUrl, "mailuser");

    const forgot = await new ApiClient(baseUrl).request<{
      accepted: boolean;
      delivered?: boolean;
      resetToken?: string;
    }>("/api/auth/password/forgot", {
      method: "POST",
      json: { email: user.email },
      // The language cookie selects the template language.
      headers: { cookie: "filazero_lang=en" },
    });

    reporter.equal("email: the recovery request is accepted", forgot.status, 200);
    reporter.equal("email: delivery is reported as real", forgot.data?.delivered, true);
    reporter.equal(
      "email: the reset token is never echoed when SMTP is configured",
      forgot.data?.resetToken,
      undefined,
    );

    const delivered = await sink.waitForEmailTo(user.email);
    reporter.check(
      "email: a message was delivered over a real SMTP conversation",
      Boolean(delivered),
    );
    reporter.check(
      "email: the message is addressed to the requester",
      delivered.raw.toLowerCase().includes(user.email.toLowerCase()),
    );
    // Headers are RFC 2047 encoded, so assert on the (quoted-printable
    // decoded) body, where spaces and words are preserved.
    const decodedEn = decodeQuotedPrintable(delivered.raw);
    reporter.check(
      "email: the language cookie selects the English template",
      /We received a request to reset the password/.test(decodedEn),
    );
    reporter.check(
      "email: the Portuguese wording is not used for an EN request",
      !/Recebemos um pedido para redefinir a palavra-passe/.test(decodedEn),
    );

    const token = extractResetToken(delivered.raw);
    reporter.check("email: the message carries a usable reset link", typeof token === "string");

    reporter.equal(
      "email: the emailed token resets the password",
      (
        await anonymous.post("/api/auth/password/reset", {
          token,
          password: "EmailedPass123!",
        })
      ).status,
      200,
    );
    reporter.equal(
      "email: the new password works",
      (await loginUser(baseUrl, user.email, "EmailedPass123!")).client.cookieHeader().length > 0,
      true,
    );
    reporter.equal(
      "email: the emailed token is single-use",
      (
        await anonymous.post("/api/auth/password/reset", {
          token,
          password: "AnotherEmailed123!",
        })
      ).status,
      400,
    );

    // A Portuguese request must produce the PT template.
    const ptUser = await createUser(baseUrl, "mailuserpt");
    await anonymous.post("/api/auth/password/forgot", { email: ptUser.email });
    const ptDelivered = await sink.waitForEmailTo(ptUser.email);
    const decodedPt = decodeQuotedPrintable(ptDelivered.raw);
    reporter.check(
      "email: a request without a language cookie uses Portuguese",
      /Recebemos um pedido para redefinir a palavra-passe/.test(decodedPt),
    );
    reporter.check(
      "email: the English wording is not used for a PT request",
      !/We received a request to reset the password/.test(decodedPt),
    );

    // The old password must still be the one for the second user.
    reporter.check(
      "email: unrelated users are not affected",
      (await loginUser(baseUrl, ptUser.email, DEFAULT_PASSWORD)).client.cookieHeader().length > 0,
    );
  } finally {
    await sink.stop();
  }
}
