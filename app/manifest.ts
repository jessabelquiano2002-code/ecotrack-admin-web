import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MetroWaste Administration",
    short_name: "MetroWaste",
    description: "Catbalogan City Waste Management System",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#087a59",
    orientation: "any",
    icons: [
      {
        src: "/pwa-icons/wastetrack-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa-icons/wastetrack-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
