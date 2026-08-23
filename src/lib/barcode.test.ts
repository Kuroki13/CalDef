import { describe, expect, it } from "vitest";

import {
  checkScannerSupport,
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

describe("checkScannerSupport — the four failures are four messages", () => {
  it("reports readiness when everything is present", () => {
    const result = checkScannerSupport(win());
    expect(result.status).toBe("ready");
    expect(result.manualOnly).toBe(false);
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

  it("distinguishes an unsupported browser from a missing camera", () => {
    const result = checkScannerSupport(win({ BarcodeDetector: undefined }));

    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/Safari|Firefox/);
    expect(result.message).not.toMatch(/permission/i);
  });

  it("reports a missing camera when the API exists but the device has none", () => {
    const result = checkScannerSupport(win({ navigator: {} }));
    expect(result.status).toBe("no-camera");
    expect(result.manualOnly).toBe(true);
  });

  it("always offers the manual path", () => {
    for (const broken of [
      win({ isSecureContext: false }),
      win({ BarcodeDetector: undefined }),
      win({ navigator: {} }),
    ]) {
      expect(checkScannerSupport(broken).message).toMatch(/by name/);
    }
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
