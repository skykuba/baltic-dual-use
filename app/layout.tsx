import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Baltic Dual-Use — nawigacja GPS-denied",
  description:
    "Estymacja pozycji pieszego bez sygnału satelitarnego: PDR, map matching na OpenStreetMap i korekcja ręczna.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`h-full ${inter.variable} ${geistMono.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
