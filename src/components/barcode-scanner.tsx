"use client";

/**
 * Camera barcode scanner.
 *
 * Capability is checked before the camera is ever requested, so someone on
 * plain HTTP is told the real reason instead of being shown a permission
 * prompt that cannot help them. See `lib/barcode.ts` for why the failure
 * modes are kept apart.
 *
 * Two decoders, one loop. `BarcodeDetector` is used where the browser has
 * it; where it does not — which is every browser on iOS, and therefore the
 * only device this app is actually used from — a JavaScript decoder is
 * downloaded on the first scan. It is loaded with `await import()` so the
 * browsers that already have a decoder never pay for the one they don't
 * need.
 *
 * Typing the number and searching by name are offered throughout, not only
 * when something fails — per ARCHITECTURE invariant 7's spirit, a capability
 * the browser withholds degrades the feature rather than blocking the task.
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
  type DecoderKind,
  type Detector,
  type ScannerCapability,
  cameraWillNotPlay,
  checkScannerSupport,
  decoderUnavailable,
  describeCameraError,
  isPlausibleBarcode,
  noFramesArrived,
} from "@/lib/barcode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * How often the JavaScript decoder looks at a frame.
 *
 * The native detector is cheap enough to run every frame. This one is not —
 * it decodes on the main thread, so at 60 fps it would fight the camera
 * preview for the CPU on the phone that needs it most. Five looks a second
 * is far more than a hand holding a packet steady requires.
 */
const FALLBACK_INTERVAL_MS = 200;

/**
 * How long a live stream may send nothing before the user is told.
 *
 * Long enough for a phone camera to wake, focus and deliver a first frame,
 * which on an older handset is not instant. Short enough that nobody stares
 * at a grey rectangle wondering whether it is their fault.
 */
const FIRST_FRAME_TIMEOUT_MS = 6000;

type NativeDetector = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};

/**
 * The decoder for this browser, native where possible.
 *
 * The fallback branch is the only place the heavy module is named, and it is
 * named in an `import()` — see `lib/barcode-fallback.ts` for why that
 * matters.
 */
async function loadDetector(kind: DecoderKind): Promise<Detector> {
  if (kind === "native") {
    const DetectorCtor = (
      window as unknown as {
        BarcodeDetector: new (o: {
          formats: readonly string[];
        }) => NativeDetector;
      }
    ).BarcodeDetector;
    const native = new DetectorCtor({ formats: BARCODE_FORMATS });
    return { detect: (video) => native.detect(video) };
  }

  const { createFallbackDetector } = await import("@/lib/barcode-fallback");
  return createFallbackDetector();
}

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
  // Kept across scans: downloading the decoder twice would be a waste, and
  // ZXing's reader is reusable.
  const detectorRef = useRef<Detector | null>(null);

  const [scanning, setScanning] = useState(false);
  const [preparing, setPreparing] = useState(false);
  /** Set the first time a frame has real dimensions; watched by the timer. */
  const framesRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the browser can do, known before the camera is ever touched:
  // probing permission as a side effect of rendering would prompt someone
  // who has not asked to scan anything.
  const detected = useSyncExternalStore(
    subscribeToNothing,
    readCapability,
    noCapabilityOnServer,
  );
  // Replaced only by a real failure, which is an event, not a render.
  const [failure, setFailure] = useState<ScannerCapability | null>(null);
  const capability = failure ?? detected;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    // Released explicitly: an element left holding a dead stream keeps the
    // last frame on screen, which reads as a working camera that has frozen.
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  /**
   * Attaches the stream at the moment the element exists.
   *
   * This is a callback ref rather than an assignment inside `start`, and
   * that is the whole fix for the bug this scanner shipped with: the
   * `<video>` is only rendered while `scanning` is true, so `start` was
   * setting `srcObject` on a ref that was still null, the `if` guard
   * swallowed it, and the element then mounted with no stream. Permission
   * granted, light on, grey box, and a decode loop reading an empty
   * element forever.
   *
   * A callback ref fires exactly when React attaches the node, which is
   * the earliest moment the stream *can* be attached — no ordering to get
   * wrong, and nothing to guess at with a timer.
   */
  const attachStream = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;

    const stream = streamRef.current;
    if (!element || !stream) return;

    // Idempotent: React may attach the same node twice in development, and
    // reassigning a live stream restarts it for no reason.
    if (element.srcObject !== stream) element.srcObject = stream;

    // `autoPlay` covers this in every browser that honours it; the explicit
    // call covers the ones that want a gesture, and the rejection is now a
    // state instead of a silence.
    void element.play?.().catch(() => {
      stop();
      setFailure(cameraWillNotPlay());
    });
  }, [stop]);

  // Releasing the camera on unmount matters: a stream left running keeps the
  // device's camera light on after the user has navigated away.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    const support = checkScannerSupport(window);
    if (support.status !== "ready" || support.decoder === null) {
      setFailure(support);
      return;
    }
    setFailure(null);
    setPreparing(true);

    // The decoder is fetched before the camera, so a failed download does
    // not leave the camera light on while there is nothing to decode with.
    let detector: Detector;
    try {
      detectorRef.current ??= await loadDetector(support.decoder);
      detector = detectorRef.current;
    } catch {
      setPreparing(false);
      setFailure(decoderUnavailable());
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });

      // The stream is in place *before* the element is asked for, so that
      // the callback ref has something to attach the moment it fires.
      streamRef.current = stream;
      framesRef.current = false;
      setScanning(true);

      // A stream that sends nothing is a state, not a mystery. If no frame
      // with real dimensions has arrived by the time this fires, say so.
      watchdogRef.current = setTimeout(() => {
        if (framesRef.current) return;
        stop();
        setFailure(noFramesArrived());
      }, FIRST_FRAME_TIMEOUT_MS);

      let lastLookAt = 0;

      const tick = async (now: number) => {
        // Keyed on the stream, not the element: the first frames can be
        // requested before React has mounted the video, and returning here
        // would end the loop before it began.
        if (!streamRef.current) return;

        const video = videoRef.current;
        const ready = video !== null && video.videoWidth > 0;
        if (ready) framesRef.current = true;

        const due =
          support.decoder === "native" ||
          now - lastLookAt >= FALLBACK_INTERVAL_MS;

        if (ready && due) {
          lastLookAt = now;
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
        }

        rafRef.current = requestAnimationFrame((next) => void tick(next));
      };

      rafRef.current = requestAnimationFrame((now) => void tick(now));
    } catch (error) {
      stop();
      setFailure(describeCameraError(error));
    } finally {
      setPreparing(false);
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
            ref={attachStream}
            className="bg-muted aspect-video w-full rounded-md object-cover"
            autoPlay
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
        <>
          <div className="flex gap-2">
            <PendingButton
              type="button"
              onClick={start}
              disabled={capability?.manualOnly === true}
              pending={preparing}
              pendingLabel="Starting the camera…"
              className="flex-1"
            >
              {capability?.status === "permission-denied" ||
              capability?.status === "decoder-unavailable"
                ? "Try again"
                : "Scan a barcode"}
            </PendingButton>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>

          <ManualEntry onSubmitted={onDetected} />
        </>
      )}
    </div>
  );
}

/**
 * Typing the number under the barcode.
 *
 * Always available, not only after something fails. A camera that cannot
 * focus in a dim aisle is at least as common as one the browser refuses, and
 * both leave the same 13 digits printed on the packet. It resolves through
 * exactly the same lookup the camera feeds, so the result is identical.
 */
function ManualEntry({
  onSubmitted,
}: {
  onSubmitted: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = code.trim();
        if (!isPlausibleBarcode(trimmed)) {
          setError("A barcode is 6 to 14 digits, with nothing else in it.");
          return;
        }
        setError(null);
        setCode("");
        onSubmitted(trimmed);
      }}
      className="space-y-2 border-t pt-3"
    >
      <Label htmlFor="manual-barcode" className="text-xs">
        Or type the number under the barcode
      </Label>
      <div className="flex gap-2">
        <Input
          id="manual-barcode"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (error) setError(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 3017624010701"
        />
        <PendingButton type="submit" variant="secondary">
          Look up
        </PendingButton>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </form>
  );
}
