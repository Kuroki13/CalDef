import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scanner's browser-facing behaviour.
 *
 * `BarcodeScanner` memoises the capability check at module scope, because
 * what a browser can do cannot change while a page is open. That makes the
 * module itself stateful across tests, so each case imports a fresh copy
 * after arranging the window it should see.
 */
async function renderScanner(props: {
  onDetected?: (code: string) => void;
  onCancel?: () => void;
} = {}) {
  vi.resetModules();
  const { BarcodeScanner } = await import("@/components/barcode-scanner");
  return render(
    <BarcodeScanner
      onDetected={props.onDetected ?? (() => {})}
      onCancel={props.onCancel ?? (() => {})}
    />,
  );
}

function setUpWindow({
  secure = true,
  camera = true,
  nativeDetector = false,
}: { secure?: boolean; camera?: boolean; nativeDetector?: boolean } = {}) {
  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });

  if (camera) {
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
  } else {
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
  }

  if (nativeDetector) {
    (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector =
      class {};
  } else {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  }
}

beforeEach(() => setUpWindow());
afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.restoreAllMocks();
});

describe("BarcodeScanner in a browser with no BarcodeDetector", () => {
  it("offers to scan rather than refusing", async () => {
    // This is Safari, and Safari is the browser on the phone this app is
    // used from. The scan button used to be disabled here.
    setUpWindow({ nativeDetector: false });
    await renderScanner();

    expect(
      screen.getByRole("button", { name: "Scan a barcode" }),
    ).toBeEnabled();
    expect(screen.queryByText(/cannot read barcodes/i)).not.toBeInTheDocument();
  });
});

describe("BarcodeScanner when the camera is unavailable", () => {
  it("says so, disables scanning, and still takes a typed barcode", async () => {
    setUpWindow({ camera: false });
    const onDetected = vi.fn();
    await renderScanner({ onDetected });

    expect(screen.getByText(/No camera is available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan a barcode" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type the number/i), {
      target: { value: "3017624010701" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(onDetected).toHaveBeenCalledWith("3017624010701");
  });

  it("names HTTPS, not permissions, on an insecure origin", async () => {
    setUpWindow({ secure: false, camera: false });
    await renderScanner();

    expect(screen.getByText(/HTTPS/)).toBeInTheDocument();
  });
});

describe("manual barcode entry", () => {
  it("refuses what the database would refuse, without calling the lookup", async () => {
    const onDetected = vi.fn();
    await renderScanner({ onDetected });

    fireEvent.change(screen.getByLabelText(/type the number/i), {
      target: { value: "not-a-barcode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(onDetected).not.toHaveBeenCalled();
    expect(screen.getByText(/6 to 14 digits/)).toBeInTheDocument();
  });

  it("clears the complaint as soon as the number is being corrected", async () => {
    await renderScanner();
    const field = screen.getByLabelText(/type the number/i);

    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(screen.getByText(/6 to 14 digits/)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "123456" } });
    expect(screen.queryByText(/6 to 14 digits/)).not.toBeInTheDocument();
  });

  it("is offered alongside a working camera, not only when one fails", async () => {
    setUpWindow({ nativeDetector: true });
    await renderScanner();

    expect(screen.getByLabelText(/type the number/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan a barcode" })).toBeEnabled();
  });
});
