import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
  themeColor: "#18181b",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
