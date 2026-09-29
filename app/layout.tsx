import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gran Sorteo Supricom",
  description: "Ruleta del sorteo de clientes de Supricom: cada compra del mes suma tickets.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#040b24" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
