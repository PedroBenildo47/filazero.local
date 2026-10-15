"use client";
/**
 * Hero image carousel for the public landing page.
 *
 * Rotates a small set of real photographs so the main screen is not a static
 * gradient (one image fades in as the previous fades out). Images are shipped
 * from `/public/marketing`, so they load from our own origin and need no
 * external request. The rotation pauses on hover/focus and respects
 * `prefers-reduced-motion`.
 */
import { useEffect, useState } from "react";

export interface HeroSlide {
  src: string;
  alt: string;
}

const ROTATION_MS = 5000;

export function HeroCarousel({ slides, label }: { slides: HeroSlide[]; label: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (slides.length <= 1 || paused) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(
      () => setIndex((current) => (current + 1) % slides.length),
      ROTATION_MS,
    );
    return () => window.clearInterval(id);
  }, [slides.length, paused]);

  return (
    <div
      className="hero-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {slides.map((slide, position) => (
        <div
          key={slide.src}
          className={`hero-slide${position === index ? " is-active" : ""}`}
          aria-hidden={position !== index}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.src}
            alt={slide.alt}
            loading={position === 0 ? "eager" : "lazy"}
            draggable={false}
          />
        </div>
      ))}

      <div className="hero-dots" role="tablist" aria-label={label}>
        {slides.map((slide, position) => (
          <button
            key={slide.src}
            type="button"
            role="tab"
            aria-selected={position === index}
            aria-label={slide.alt}
            className={`hero-dot${position === index ? " is-active" : ""}`}
            onClick={() => setIndex(position)}
          />
        ))}
      </div>
    </div>
  );
}
