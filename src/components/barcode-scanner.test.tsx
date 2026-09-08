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

/** A stream object standing in for the one `getUserMedia` resolves with. */
function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], __track: track } as unknown as MediaStream;
}

function setUpWindow({
  secure = true,
  camera = true,
  nativeDetector = false,
  stream,
}: {
  secure?: boolean;
  camera?: boolean;
  nativeDetector?: boolean;
  stream?: MediaStream;
} = {}) {
  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });

  if (camera) {
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream ?? fakeStream()),
      },
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

describe("BarcodeScanner — the stream reaches the element", () => {
  /**
   * The bug this suite exists for.
   *
   * The `<video>` is only rendered while scanning, and `start` used to
   * assign `srcObject` before flipping that flag — so the ref was null, the
   * `if` guard swallowed it, and the element mounted with no stream.
   * Permission granted, camera light on, grey box, and a decode loop
   * reading an empty element forever. Nothing failed, which is why nothing
   * caught it: the old tests only ever exercised the paths where the camera
   * was refused.
   */
  beforeEach(() => {
    // jsdom implements neither, and both are on the path being tested.
    Object.defineProperty(window.HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  async function startScanning(stream = fakeStream()) {
    setUpWindow({ nativeDetector: true, stream });
    await renderScanner();

    fireEvent.click(screen.getByRole("button", { name: "Scan a barcode" }));
    // The camera resolves, the element mounts, the ref callback fires.
    const video = await screen.findByLabelText(/camera preview/i);
    return { video: video as HTMLVideoElement, stream };
  }

  it("sets srcObject on the element once it is mounted", async () => {
    const { video, stream } = await startScanning();

    expect(video.srcObject).toBe(stream);
  });

  it("plays it, and marks the element to autoplay", async () => {
    const { video } = await startScanning();

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
  });

  it("says so when the browser refuses to play the stream", async () => {
    window.HTMLMediaElement.prototype.play = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await startScanning();

    expect(
      await screen.findByText(/would not start playing/i),
    ).toBeInTheDocument();
  });

  it("releases the stream when scanning stops", async () => {
    const stream = fakeStream();
    const { video } = await startScanning(stream);

    fireEvent.click(screen.getByRole("button", { name: /stop scanning/i }));

    expect(
      (stream as unknown as { __track: { stop: () => void } }).__track.stop,
    ).toHaveBeenCalled();
    // An element left holding a dead stream shows a frozen last frame,
    // which reads as a camera that works and has hung.
    expect(video.srcObject).toBeNull();
  });
});

describe("BarcodeScanner — a camera that sends no picture", () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => vi.useRealTimers());

  it("says so rather than leaving a grey box on screen", async () => {
    // `videoWidth` stays 0 in jsdom, which is exactly the symptom: a live
    // stream that never delivers a frame.
    setUpWindow({ nativeDetector: true });
    await renderScanner();

    fireEvent.click(screen.getByRole("button", { name: "Scan a barcode" }));
    await screen.findByLabelText(/camera preview/i);

    await vi.advanceTimersByTimeAsync(7000);

    expect(await screen.findByText(/sent no picture/i)).toBeInTheDocument();
  });
});
