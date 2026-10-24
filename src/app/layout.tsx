import type { Metadata } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans, Vazirmatn } from "next/font/google";
import "./globals.css";

// Portrait design system. Switzer → Inter (UI and body) · Basier Circle → Plus Jakarta Sans (display,
// tight tracking) · Vazirmatn: Persian (RTL) reports · Geist Mono: numbers and ids
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"], style: ["normal", "italic"], display: "swap" });
const sans = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const vazir = Vazirmatn({ variable: "--font-vazir", subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Italy Admission Studio",
  description: "Multi-agent admission and scholarship assessment for Italian public universities",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} ${mono.variable} ${vazir.variable} antialiased`}>{children}</body>
    </html>
  );
}
