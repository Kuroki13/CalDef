import { describe, expect, it } from "vitest";

import {
  checkScannerSupport,
  decoderUnavailable,
  describeCameraError,
  isPlausibleBarcode,
} from "@/lib/barcode";

const win = (over: Record<string, unknown> = {}) =>
  ({
    isSecureContext: true,
    BarcodeDetector: class {},
    navigator: { mediaDevices: { getUserMedia: () => Promise.resolve() } },
    ...over,
  }) as unknown as Parameters<typeof checkScannerSupport>[0];

describe("checkScannerSupport — each failure gets its own message", () => {
  it("reports readiness when everything is present", () => {
    const result = checkScannerSupport(win());
    expect(result.status).toBe("ready");
    expect(result.manualOnly).toBe(false);
    expect(result.decoder).toBe("native");
  });

  it("names HTTPS as the cause on an insecure origin", () => {
    // The case that matters on a phone over plain HTTP on the LAN.
    const result = checkScannerSupport(win({ isSecureContext: false }));

    expect(result.status).toBe("insecure-context");
    expect(result.message).toContain("HTTPS");
    expect(result.manualOnly).toBe(true);
    // It must not send the user hunting through permission settings, since
    // granting permission cannot fix an insecure origin.
    expect(result.message).not.toMatch(/permission|site settings|try again/i);
  });

  it("checks the secure context before anything else", () => {
    // On plain HTTP, mediaDevices is absent too — reporting "no camera"
    // would be true but useless, since HTTPS is the actual fix.
    const result = checkScannerSupport({
      isSecureContext: false,
      navigator: {},
    } as unknown as Parameters<typeof checkScannerSupport>[0]);

    expect(result.status).toBe("insecure-context");
  });

  it("scans in a browser with no BarcodeDetector, using the fallback", () => {
    // The whole point: this is Safari, and Safari is the only browser the
    // owner's iPhone can run. Before the fallback existed this returned
    // "unsupported" and the scan button was disabled, which made the
    // feature dead on the one device it was built for.
    const result = checkScannerSupport(win({ BarcodeDetector: undefined }));

    expect(result.status).toBe("ready");
    expect(result.decoder).toBe("fallback");
    expect(result.manualOnly).toBe(false);
  });

  it("still reports a missing camera when the decoder would be the fallback", () => {
    // No camera is no camera, whichever decoder would have read the frame.
    const result = checkScannerSupport(
      win({ BarcodeDetector: undefined, navigator: {} }),
    );

    expect(result.status).toBe("no-camera");
    expect(result.decoder).toBeNull();
  });

  it("reports a missing camera when the API exists but the device has none", () => {
    const result = checkScannerSupport(win({ navigator: {} }));
    expect(result.status).toBe("no-camera");
    expect(result.manualOnly).toBe(true);
  });

  it("always offers both manual paths when scanning is impossible", () => {
    for (const broken of [win({ isSecureContext: false }), win({ navigator: {} })]) {
      const { message } = checkScannerSupport(broken);
      expect(message).toMatch(/by name/);
      expect(message).toMatch(/barcode number|number under the barcode/);
    }
  });
});

describe("decoderUnavailable — the fallback failed to download", () => {
  it("is its own state, and a retryable one", () => {
    const result = decoderUnavailable();

    expect(result.status).toBe("decoder-unavailable");
    expect(result.decoder).toBeNull();
    // A failed download is a network problem, so trying again can work —
    // which is why this is not `manualOnly`.
    expect(result.manualOnly).toBe(false);
    expect(result.message).toMatch(/try again/i);
    // And it must not be blamed on permissions, which cannot fix it.
    expect(result.message).not.toMatch(/permission|site settings/i);
  });
});

describe("describeCameraError", () => {
  const err = (name: string) => Object.assign(new Error("x"), { name });

  it("treats a refusal as recoverable, not terminal", () => {
    const result = describeCameraError(err("NotAllowedError"));

    expect(result.status).toBe("permission-denied");
    expect(result.message).toMatch(/site settings/);
    // The user can grant permission, so manual search is not the only way.
    expect(result.manualOnly).toBe(false);
  });

  it("maps SecurityError to a permission problem too", () => {
    expect(describeCameraError(err("SecurityError")).status).toBe(
      "permission-denied",
    );
  });

  it("maps a missing device to no-camera", () => {
    expect(describeCameraError(err("NotFoundError")).status).toBe("no-camera");
    expect(describeCameraError(err("OverconstrainedError")).status).toBe(
      "no-camera",
    );
  });

  it("explains a camera held by another application", () => {
    const result = describeCameraError(err("NotReadableError"));
    expect(result.status).toBe("camera-error");
    expect(result.message).toMatch(/another application/);
  });

  it("falls back without guessing at a cause", () => {
    const result = describeCameraError(err("SomethingNew"));
    expect(result.status).toBe("camera-error");
    expect(result.message).toMatch(/by name/);
  });

  it("survives a non-Error rejection", () => {
    expect(describeCameraError("boom").status).toBe("camera-error");
    expect(describeCameraError(null).status).toBe("camera-error");
  });
});

describe("isPlausibleBarcode", () => {
  it("accepts the lengths the database accepts", () => {
    expect(isPlausibleBarcode("3017624010701")).toBe(true);
    expect(isPlausibleBarcode("123456")).toBe(true);
    expect(isPlausibleBarcode("12345678901234")).toBe(true);
  });

  it("rejects what the column would reject", () => {
    expect(isPlausibleBarcode("12345")).toBe(false);
    expect(isPlausibleBarcode("123456789012345")).toBe(false);
    expect(isPlausibleBarcode("abc123456")).toBe(false);
    expect(isPlausibleBarcode("")).toBe(false);
  });

  it("tolerates surrounding whitespace from a scan", () => {
    expect(isPlausibleBarcode(" 3017624010701 ")).toBe(true);
  });
});
