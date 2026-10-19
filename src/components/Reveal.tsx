"use client";
/**
 * Scroll-reveal wrapper.
 *
 * Reveals its children the first time they intersect the viewport, using a CSS
 * transition (fade / slide-up / scale-up). The animation is skipped entirely when
 * the user prefers reduced motion — the element is simply visible.
 */
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

type RevealVariant = "fade" | "up" | "scale";

interface RevealProps {
  children: ReactNode;
  variant?: RevealVariant;
  /** Stagger, in milliseconds. */
  delay?: number;
  className?: string;
  as?: ElementType;
}

export function Reveal({
  children,
  variant = "up",
  delay = 0,
  className = "",
  as: Tag = "div",
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (or reduced motion): show immediately.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal reveal-${variant}${visible ? " is-visible" : ""}${
        className ? ` ${className}` : ""
      }`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
