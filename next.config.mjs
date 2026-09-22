/**
 * Next.js configuration.
 *
 * `serverExternalPackages` keeps server-only dependencies out of the client
 * bundle. `headers()` applies the security header set to every response
 * (API routes included); CORS is handled in `src/middleware.ts` because it is
 * request-aware.
 */

const isProduction = process.env.NODE_ENV === "production";

/**
 * CSP note: Next.js injects inline hydration scripts, so `script-src` needs
 * `'unsafe-inline'` unless a nonce pipeline is added. `'unsafe-eval'` is only
 * required by the dev server (HMR) and is never sent in production.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

if (isProduction) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emits `.next/standalone` with only the traced runtime dependencies, which is
  // what the production Docker image ships.
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "pino"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
