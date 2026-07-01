import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ProfitLens — Find where your Shopify store is losing money",
  description:
    "ProfitLens connects to your Shopify store, detects hidden profit leaks in refunds and shipping, and tells you exactly how much you're losing and how to recover it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-[#08090c] text-slate-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
