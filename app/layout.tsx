import "./globals.css";
import type { Metadata } from "next";
import { Inter, Nunito } from "next/font/google";
import { PaletteProvider } from "@/components/theme/palette";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Watch your AI agent team at work.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${nunito.variable} ${inter.variable}`} suppressHydrationWarning>
      <body>
        <PaletteProvider>{children}</PaletteProvider>
      </body>
    </html>
  );
}
