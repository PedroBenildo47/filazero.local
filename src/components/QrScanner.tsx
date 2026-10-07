"use client";
/**
 * In-browser QR reader.
 *
 * Uses the native `BarcodeDetector` API where it exists (Chromium/Android —
 * the dominant mobile browser for this product). Where it does not, the caller
 * hides the button and offers the code/link field instead. No third-party
 * dependency and no network access: frames stay on the device.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./LanguageProvider";
import { Alert } from "./ui";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

function getDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof candidate === "function" ? candidate : null;
}

/** True when this browser can scan QR codes in-app. */
export function supportsQrScanning(): boolean {
  return getDetector() !== null;
}

export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const Detector = getDetector();
    if (!Detector) {
      setStatus("error");
      return;
    }
    const DetectorCtor: BarcodeDetectorCtor = Detector;

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setStatus("scanning");

        const detector = new DetectorCtor({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            const value = found[0]?.rawValue;
            if (value) {
              stop();
              onResult(value);
              return;
            }
          } catch {
            // Per-frame detection errors are expected (video not ready yet).
          }
          frameRef.current = requestAnimationFrame(() => void tick());
        };
        frameRef.current = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onResult, stop]);

  return (
    <section className="qr-scanner" role="dialog" aria-modal="true">
      <video ref={videoRef} className="qr-scanner-video" muted playsInline />
      <div className="qr-scanner-frame" aria-hidden="true" />
      <p className="qr-scanner-hint">
        {status === "scanning" ? t("entry.scanning") : t("common.loading")}
      </p>
      {status === "error" && <Alert kind="error">{t("entry.scanUnsupported")}</Alert>}
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        {t("entry.scanCancel")}
      </button>
    </section>
  );
}
