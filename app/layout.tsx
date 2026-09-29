import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gran Sorteo Supricom · Caracas",
  description: "Ruleta del sorteo de clientes de Supricom Caracas: cada $5.000 en compras del mes es 1 ticket.",
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
