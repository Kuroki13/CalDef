/**
 * What the barcode scanner can and cannot do in this browser, right now.
 *
 * Reading a barcode needs two things: a camera, and something that can
 * decode a picture of one. The camera is the browser's to give. The decoder
 * is not — `BarcodeDetector` exists in Chrome and Edge and does not exist in
 * WebKit, which is every browser on iOS. Since the phone in question is an
 * iPhone, a scanner that depends on `BarcodeDetector` is a scanner that
 * never runs, so a JavaScript decoder is loaded instead when the native one
 * is missing (see `lib/barcode-fallback.ts`).
 *
 * That leaves these distinct outcomes, and they need distinct answers
 * because the remedies differ:
 *
 *   insecure-context     — the page is not on HTTPS or localhost.
 *                          `getUserMedia` is unavailable full stop. Opening
 *                          the same app over HTTPS fixes it; nothing in the
 *                          page can.
 *   no-camera            — no camera API, or no camera on the device.
 *   permission-denied    — everything is present and the user said no.
 *   decoder-unavailable  — no `BarcodeDetector` and the fallback decoder
 *                          failed to load, which means the network dropped
 *                          the chunk. Retrying can work; permissions cannot.
 *
 * Collapsing these into one "camera failed" message would send someone to
 * check their browser permissions when the real problem is that they are on
 * plain HTTP, which no amount of permission-granting will fix.
 *
 * Every one of them still leaves two ways to log the product: search it by
 * name, or type the number under the barcode. The scanner offers both.
 *
 * Deliberately client-safe: no `server-only` import, because this runs in the
 * browser and reads browser capabilities.
 */

export type ScannerStatus =
  | "ready"
  | "insecure-context"
  | "no-camera"
  | "permission-denied"
  | "camera-error"
  | "decoder-unavailable"
  | "no-frames";

/**
 * Which decoder a scan would use.
 *
 * `native` is `BarcodeDetector`, which the browser implements. `fallback` is
 * the JavaScript decoder, which has to be downloaded before the first scan —
 * so the two are not interchangeable from the UI's point of view, and the
 * fallback path has a loading state the native one does not need.
 */
export type DecoderKind = "native" | "fallback";

export type ScannerCapability = {
  status: ScannerStatus;
  /** Shown to the user. States the cause and, where one exists, the remedy. */
  message: string;
  /** True when typing the number or searching by name is the only way forward. */
  manualOnly: boolean;
  /** Set when a scan is possible; null when it is not. */
  decoder: DecoderKind | null;
};

/**
 * The camera said yes and then sent nothing.
 *
 * A live stream with no frames coming out of it is a real state, not a
 * theoretical one: the permission is granted, the light may even be on, and
 * the preview is a grey rectangle. It happened here for a much dafter
 * reason — the stream was attached to an element that did not exist yet —
 * but the symptom is the same whatever causes it, and a blank box that
 * explains nothing is the worst possible answer to "why is this not
 * working". So it is watched for and named.
 */
export function noFramesArrived(): ScannerCapability {
  return {
    status: "no-frames",
    message:
      "The camera started but sent no picture. Close anything else using " +
      "it and try again — or type the number under the barcode, or search " +
      "for the product by name.",
    manualOnly: false,
    decoder: null,
  };
}

/**
 * The browser refused to play the stream.
 *
 * Autoplay policies block playback that a user gesture did not cause, and
 * a muted inline video is normally exempt — but "normally" is not "always",
 * and a rejected `play()` used to be swallowed.
 */
export function cameraWillNotPlay(): ScannerCapability {
  return {
    status: "camera-error",
    message:
      "The camera would not start playing. Try again, or type the number " +
      "under the barcode instead.",
    manualOnly: false,
    decoder: null,
  };
}

/** How a failed decoder download is reported. */
export function decoderUnavailable(): ScannerCapability {
  return {
    status: "decoder-unavailable",
    message:
      "The barcode reader could not be downloaded — check your connection " +
      "and try again. You can also type the number under the barcode, or " +
      "search for the product by name.",
    manualOnly: false,
    decoder: null,
  };
}

/**
 * Checks everything that can be known without prompting for permission.
 *
 * Returns `ready` when a scan is worth attempting. It deliberately does not
 * call `getUserMedia` — that would trigger the permission prompt as a side
 * effect of rendering a page, which is a rude thing to do to someone who has
 * not asked to scan anything yet.
 */
export function checkScannerSupport(
  win: Pick<Window, "isSecureContext"> & {
    BarcodeDetector?: unknown;
    navigator?: Partial<Navigator>;
  },
): ScannerCapability {
  if (!win.isSecureContext) {
    return {
      status: "insecure-context",
      message:
        "Your browser only allows camera access over HTTPS. This page is not " +
        "on a secure connection, so scanning is unavailable — open the app " +
        "over HTTPS to use it. You can still type the barcode number, or " +
        "search for the product by name.",
      manualOnly: true,
      decoder: null,
    };
  }

  if (!win.navigator?.mediaDevices?.getUserMedia) {
    return {
      status: "no-camera",
      message:
        "No camera is available to this browser. Type the number under the " +
        "barcode, or search for the product by name.",
      manualOnly: true,
      decoder: null,
    };
  }

  // A missing `BarcodeDetector` is no longer a dead end; it selects the
  // decoder that gets downloaded on the first scan instead. Safari is the
  // whole reason this branch exists.
  return {
    status: "ready",
    message: "",
    manualOnly: false,
    decoder:
      typeof win.BarcodeDetector === "undefined" ? "fallback" : "native",
  };
}

/**
 * Turns a `getUserMedia` rejection into the right one of the cases above.
 *
 * The DOMException names are the browser's own vocabulary for this and are
 * far more reliable than matching on message text, which varies by vendor
 * and by locale.
 */
export function describeCameraError(error: unknown): ScannerCapability {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        status: "permission-denied",
        message:
          "Camera access was declined. You can allow it in your browser's " +
          "site settings and try again, or search for the product by name.",
        manualOnly: false,
        decoder: null,
      };

    case "NotFoundError":
    case "OverconstrainedError":
      return {
        status: "no-camera",
        message:
          "No camera matching the request was found on this device. Type the " +
          "number under the barcode, or search for the product by name.",
        manualOnly: true,
        decoder: null,
      };

    case "NotReadableError":
      return {
        status: "camera-error",
        message:
          "The camera is in use by another application. Close it and try " +
          "again, or search for the product by name.",
        manualOnly: false,
        decoder: null,
      };

    default:
      return {
        status: "camera-error",
        message:
          "The camera could not be started. Type the number under the " +
          "barcode, or search for the product by name.",
        manualOnly: false,
        decoder: null,
      };
  }
}

/**
 * What the scanner needs from a decoder, native or not.
 *
 * Declared here rather than beside the fallback implementation so that
 * nothing has to import that module to name its type — a value import of it
 * would pull the whole decoder into the bundle it is meant to stay out of.
 */
export type BarcodeDetection = { rawValue: string };
export type Detector = {
  detect(video: HTMLVideoElement): Promise<BarcodeDetection[]>;
};

/** The symbologies worth looking for on food packaging. */
export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
] as const;

/**
 * Whether a detected string is plausibly a food barcode.
 *
 * Matches the `foods.barcode` check constraint exactly, so anything accepted
 * here is something the database will also accept — and a misread that
 * produces letters or a 3-digit fragment is discarded rather than sent to a
 * provider.
 */
export function isPlausibleBarcode(value: string): boolean {
  return /^[0-9]{6,14}$/.test(value.trim());
}
