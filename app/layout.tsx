
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./globals.css.additions.css";

export const metadata: Metadata = {
  icons: {
    icon: "/kayatech3d-logo.jpeg",
    shortcut: "/kayatech3d-logo.jpeg"
  },
  title: "Kayatech3D | 3D Baskı Teklifi",
  description:
    "STL dosyanızı yükleyin, gerçek dilimleme verileriyle 3D baskı teklifinizi hazırlayın."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050b10"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
