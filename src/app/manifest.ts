import type { MetadataRoute } from "next";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * iOS is the target (spec §7: installed from Safari's Share sheet, no App
 * Store, no developer account), and iOS reads only part of this — the name,
 * `display`, `theme_color` and, since 17.4, the icons. The `apple-touch-icon`
 * link and the Apple meta tags in `layout.tsx` are what older iOS uses, so
 * both routes are provided rather than one.
 *
 * `start_url` is `/dashboard` rather than `/`: the root immediately redirects
 * a signed-in user there, and an installed app that opens on a redirect
 * shows a blank frame first.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CalDef — nutrition tracking",
    short_name: "CalDef",
    description:
      "Nutrition tracking with an adaptive expenditure model that learns your real TDEE from intake and weight trend.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#18181b",
    theme_color: "#18181b",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        // Cropped to a circle or a squircle by the launcher, so its mark sits
        // inside the middle 80% and the background bleeds to the edge.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Diary", url: "/diary" },
      { name: "Weigh in", url: "/weight" },
    ],
  };
}
