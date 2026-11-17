import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";

import { ServiceWorker } from "@/components/service-worker";
import { ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * The display face: figures and titles. Condensed, so a four-digit calorie
 * count can be very large and still fit a phone, which is the whole idea
 * of the "scoreboard" (spec §16.1). Three weights, Latin only — about
 * 60 KB, self-hosted by next/font, no request to Google at runtime.
 */
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CalDef",
    template: "%s",
  },
  description:
    "Nutrition tracking with an adaptive expenditure model that learns your real TDEE from intake and weight trend.",
  manifest: "/manifest.webmanifest",
  applicationName: "CalDef",
  /**
   * What Safari reads for Add to Home Screen.
   *
   * `capable` makes the launched app frameless; `title` is the name written
   * under the icon, which otherwise defaults to the long `<title>`. iOS
   * before 17.4 ignores the manifest entirely, so these are not redundant
   * with it — they are the older of the two routes to the same result.
   */
  appleWebApp: {
    capable: true,
    title: "CalDef",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icon.png", sizes: "64x64", type: "image/png" }],
    // Safari looks for this by name. Opaque and unrounded: iOS applies its
    // own mask and composites transparency onto black.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: {
    // Stops iOS turning a gram figure or a date into a phone-number link.
    telephone: false,
  },
  other: {
    /**
     * The legacy spelling, which Next does not emit.
     *
     * `appleWebApp.capable` above produces only the standardised
     * `mobile-web-app-capable`, which Safari did not read until iOS 17.4.
     * Without this line an older iPhone installs the icon and then opens it
     * in a browser tab with the address bar showing, which is not an
     * installed app. Checked in the served HTML, not assumed.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1216",
  // Extends the app under the notch and the home indicator, which is what
  // `black-translucent` above assumes.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes sets the theme class before React wakes up.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          {/* Confirmations appear at the top: the bottom belongs to the
              tab bar and the thumb. */}
          <Toaster position="top-center" offset={{ top: "calc(env(safe-area-inset-top) + 3.5rem)" }} mobileOffset={{ top: "calc(env(safe-area-inset-top) + 3.5rem)" }} />
        </ThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
