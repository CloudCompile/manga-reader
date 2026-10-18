import type { MetadataRoute } from "next";

// Installable-app metadata. The reader targets constrained Android WebViews and
// flaky mobile networks, so a home-screen icon and standalone display matter
// more here than on a typical site.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Manga Reader",
    short_name: "Manga",
    description: "Ad-free manga reader",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
