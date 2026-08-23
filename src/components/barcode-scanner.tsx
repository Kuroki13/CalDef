"use client";

/**
 * Camera barcode scanner.
 *
 * Capability is checked before the camera is ever requested, so someone on
 * plain HTTP or in Safari is told the real reason instead of being shown a
 * permission prompt that cannot help them. See `lib/barcode.ts` for why the
 * four failure modes are kept apart.
 *
 * The manual search path is always offered alongside — per ARCHITECTURE
 * invariant 7's spirit, a capability the browser withholds degrades the
 * feature rather than blocking the task.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  BARCODE_FORMATS,
  type ScannerCapability,
  checkScannerSupport,
  describeCameraError,
  isPlausibleBarcode,
} from "@/lib/barcode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type DetectedBarcode = { rawValue: string };
type Detector = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };

/**
 * Browser capability, read through `useSyncExternalStore`.
 *
 * This is the sanctioned way to read something that exists only on the
 * client: the server snapshot is null, the client snapshot is the real
 * answer, and no effect is needed — so there is no render pass showing a
 * scan button to someone who cannot scan.
 *
 * The snapshot is memoised because `getSnapshot` is compared with `Object.is`
 * and a fresh object each call would loop forever. Capability cannot change
 * within a page's life, so caching it costs nothing.
 */
let cachedCapability: ScannerCapability | null = null;

function subscribeToNothing(): () => void {
  return () => {};
}

function readCapability(): ScannerCapability {
  cachedCapability ??= checkScannerSupport(window);
  return cachedCapability;
}

function noCapabilityOnServer(): null {
  return null;
}

export function BarcodeScanner({
  onDetected,
  onCancel,
}: {
  onDetected: (code: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);

  // What the browser can do, known before the camera is ever touched:
  // probing permission as a side effect of rendering would prompt someone
  // who has not asked to scan anything.
  const detected = useSyncExternalStore(
    subscribeToNothing,
    readCapability,
    noCapabilityOnServer,
  );
  // Replaced only by a real camera failure, which is an event, not a render.
  const [failure, setFailure] = useState<ScannerCapability | null>(null);
  const capability = failure ?? detected;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // Releasing the camera on unmount matters: a stream left running keeps the
  // device's camera light on after the user has navigated away.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    const support = checkScannerSupport(window);
    if (support.status !== "ready") {
      setFailure(support);
      return;
    }
    setFailure(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const DetectorCtor = (
        window as unknown as {
          BarcodeDetector: new (o: { formats: readonly string[] }) => Detector;
        }
      ).BarcodeDetector;
      const detector = new DetectorCtor({ formats: BARCODE_FORMATS });

      const tick = async () => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;

        try {
          const found = await detector.detect(video);
          const match = found
            .map((b) => b.rawValue.trim())
            // A misread producing letters or a fragment is discarded rather
            // than sent to a provider as if it were a product.
            .find(isPlausibleBarcode);

          if (match) {
            stop();
            onDetected(match);
            return;
          }
        } catch {
          // A single failed frame is normal while focusing; keep looking.
        }

        rafRef.current = requestAnimationFrame(() => void tick());
      };

      rafRef.current = requestAnimationFrame(() => void tick());
    } catch (error) {
      stop();
      setFailure(describeCameraError(error));
    }
  }, [onDetected, stop]);

  return (
    <div className="space-y-3">
      {capability && capability.status !== "ready" ? (
        <Alert variant={capability.manualOnly ? "default" : "destructive"}>
          <AlertDescription>{capability.message}</AlertDescription>
        </Alert>
      ) : null}

      {scanning ? (
        <div className="space-y-3">
          <video
            ref={videoRef}
            className="bg-muted aspect-video w-full rounded-md object-cover"
            playsInline
            muted
            aria-label="Camera preview for barcode scanning"
          />
          <p className="text-muted-foreground text-sm">
            Hold the barcode steady in the frame.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop();
              onCancel();
            }}
            className="w-full"
          >
            Stop scanning
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={start}
            disabled={capability?.manualOnly === true}
            className="flex-1"
          >
            {capability?.status === "permission-denied"
              ? "Try the camera again"
              : "Scan a barcode"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
