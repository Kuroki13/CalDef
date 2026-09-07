/**
 * The barcode decoder for browsers that do not ship one.
 *
 * `BarcodeDetector` is a Chrome and Edge feature. WebKit does not implement
 * it, and on iOS every browser is WebKit — so on the phone this app is
 * actually used from, the native path does not exist. ZXing decodes the same
 * symbologies in JavaScript and works there.
 *
 * **This module must only ever be reached through `await import()`.** It
 * pulls in the whole decoder, which is far too much to put in the bundle of
 * every page for the sake of browsers that already have one built in. A
 * static import anywhere would silently undo that.
 *
 * The interface it returns is deliberately the shape of the native
 * `BarcodeDetector`, so the scanner has one loop and one code path rather
 * than a fork per browser.
 */

import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

import type { BarcodeDetection, Detector } from "@/lib/barcode";

/**
 * The same symbologies `BARCODE_FORMATS` names, in ZXing's vocabulary.
 *
 * Restricting them is not only tidiness: every extra format is another
 * decoding attempt per frame, and this decoder runs on a phone's CPU rather
 * than in the browser's own optimised code.
 */
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
];

/**
 * Builds a detector backed by ZXing.
 *
 * The canvas is created once and reused. ZXing decodes from a canvas rather
 * than from a video element, so each call copies the current frame across —
 * at the stream's own resolution, because downscaling to save CPU is exactly
 * what stops a barcode resolving at arm's length.
 */
export function createFallbackDetector(): Detector {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
  ]);
  const reader = new BrowserMultiFormatReader(hints);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return {
    async detect(video: HTMLVideoElement): Promise<BarcodeDetection[]> {
      // Before the first frame arrives the video has no dimensions, and
      // drawing it would throw.
      if (!context || video.videoWidth === 0 || video.videoHeight === 0) {
        return [];
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        return [{ rawValue: reader.decodeFromCanvas(canvas).getText() }];
      } catch {
        // `NotFoundException` on a frame with no barcode in it, which is
        // most frames. The native detector returns an empty array for the
        // same situation, so this one does too.
        return [];
      }
    },
  };
}
