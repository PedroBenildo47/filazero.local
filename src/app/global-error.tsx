"use client";
/**
 * Global error boundary — catches failures in the root layout itself.
 * It must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#030a13",
          color: "#d7ecf7",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>Algo correu mal</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1.25rem" }}>
            Ocorreu um erro inesperado ao carregar a aplicação.
            {error.digest ? ` (ref: ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "10px",
              border: "1px solid rgba(125,211,252,0.4)",
              background: "linear-gradient(135deg,#06b6d4,#2563eb)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
