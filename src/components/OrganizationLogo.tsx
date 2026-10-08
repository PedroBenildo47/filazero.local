/**
 * Organization logo.
 *
 * Renders the organization's official logo when one was uploaded (or an
 * external `logoUrl` was configured) and falls back to the company initial
 * otherwise, so public screens never show a broken image.
 *
 * The uploaded logo is served by the public endpoint
 * `GET /api/public/organizations/:id/logo`, which is cache-friendly and needs no
 * authentication — safe for the waiting-room display and the kiosk.
 */

export interface OrganizationLogoProps {
  logoUrl: string | null | undefined;
  /** Used for the `alt` text and the fallback initial. */
  name: string;
  /** Rendered size in pixels (square). */
  size?: number;
  /** Colour scheme of the surrounding surface (affects the fallback). */
  variant?: "light" | "dark";
  className?: string;
}

export function OrganizationLogo({
  logoUrl,
  name,
  size = 48,
  variant = "light",
  className,
}: OrganizationLogoProps) {
  const shared = {
    width: size,
    height: size,
    style: {
      width: size,
      height: size,
      objectFit: "contain" as const,
      borderRadius: Math.max(6, Math.round(size * 0.18)),
      flexShrink: 0,
    },
  };

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className={["org-logo", `org-logo--${variant}`, className]
          .filter(Boolean)
          .join(" ")}
        {...shared}
      />
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || "F";
  return (
    <span
      aria-hidden="true"
      className={["org-logo-fallback", `org-logo-fallback--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...shared.style,
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.44),
        fontWeight: 700,
      }}
    >
      {initial}
    </span>
  );
}
