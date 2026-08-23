/**
 * What the barcode scanner can and cannot do in this browser, right now.
 *
 * Four different things go wrong here and they need four different answers,
 * because three of them are fixable by the user and one is not:
 *
 *   insecure-context   — the page is not on HTTPS or localhost. `getUserMedia`
 *                        is unavailable full stop. Opening the same app over
 *                        HTTPS fixes it; nothing in the page can.
 *   unsupported        — no `BarcodeDetector`. Chrome and Edge have it;
 *                        Safari and Firefox do not. Not a permission problem
 *                        and not fixable by granting anything.
 *   no-camera          — secure and supported, but the device has no camera.
 *   permission-denied  — everything is present and the user said no.
 *
 * Collapsing these into one "camera failed" message would send someone to
 * check their browser permissions when the real problem is that they are on
 * plain HTTP, which no amount of permission-granting will fix.
 *
 * Deliberately client-safe: no `server-only` import, because this runs in the
 * browser and reads browser capabilities.
 */

export type ScannerStatus =
  | "ready"
  | "insecure-context"
  | "unsupported"
  | "no-camera"
  | "permission-denied"
  | "camera-error";

export type ScannerCapability = {
  status: ScannerStatus;
  /** Shown to the user. States the cause and, where one exists, the remedy. */
  message: string;
  /** True when the manual-search fallback is the only way forward. */
  manualOnly: boolean;
};

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
        "over HTTPS to use it. You can still search for the product by name.",
      manualOnly: true,
    };
  }

  if (typeof win.BarcodeDetector === "undefined") {
    return {
      status: "unsupported",
      message:
        "This browser cannot read barcodes — the feature exists in Chrome and " +
        "Edge but not yet in Safari or Firefox. Search for the product by " +
        "name instead, or open the app in a browser that supports it.",
      manualOnly: true,
    };
  }

  if (!win.navigator?.mediaDevices?.getUserMedia) {
    return {
      status: "no-camera",
      message:
        "No camera is available to this browser. Search for the product by " +
        "name instead.",
      manualOnly: true,
    };
  }

  return { status: "ready", message: "", manualOnly: false };
}

/**
 * Turns a `getUserMedia` rejection into the right one of the four cases.
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
      };

    case "NotFoundError":
    case "OverconstrainedError":
      return {
        status: "no-camera",
        message:
          "No camera matching the request was found on this device. Search " +
          "for the product by name instead.",
        manualOnly: true,
      };

    case "NotReadableError":
      return {
        status: "camera-error",
        message:
          "The camera is in use by another application. Close it and try " +
          "again, or search for the product by name.",
        manualOnly: false,
      };

    default:
      return {
        status: "camera-error",
        message:
          "The camera could not be started. Search for the product by name " +
          "instead.",
        manualOnly: false,
      };
  }
}

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
