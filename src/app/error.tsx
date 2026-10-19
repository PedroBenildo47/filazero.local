"use client";
/**
 * Route-level error boundary.
 *
 * Turns an unexpected render/runtime error into a calm, branded screen with a
 * retry action, instead of the raw Next.js error overlay.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error in the console for debugging; the user sees a calm UI.
    console.error(error);
  }, [error]);

  return (
    <main className="container">
      <div className="error-state">
        <span className="error-state-icon" aria-hidden="true">
          !
        </span>
        <h1>Algo correu mal</h1>
        <p className="muted">
          Não foi possível carregar esta página. Pode ter sido uma falha temporária de ligação.
        </p>
        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Tentar novamente
          </button>
          <Link href="/" className="btn btn-ghost">
            Ir para o início
          </Link>
        </div>
      </div>
    </main>
  );
}
