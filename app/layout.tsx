
import type { Metadata } from "next";
import "./globals.css";
import "./globals.css.additions.css";

export const metadata: Metadata = {
  title: "Kayatech3D | 3D Baskı Teklifi",
  description:
    "STL dosyanızı yükleyin, gerçek dilimleme verileriyle 3D baskı teklifinizi hazırlayın."
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
