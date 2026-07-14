import { Geist, Geist_Mono } from "next/font/google";

import { themeScript } from "@/lib/theme-script";
import { AuthProvider } from "@/providers/auth-provider";
import { ConfigProvider } from "@/providers/config-provider";
import { ThemeProvider } from "@/providers/theme-provider";

import "./globals.css";

import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ragworks",
  description: "An open-source workbench for building, running, and inspecting RAG pipelines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the pre-paint theme script sets data-theme on
    // <html> before React hydrates, which is an intentional server/client diff.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-canvas text-body`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider>
          <AuthProvider>
            <ConfigProvider>{children}</ConfigProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
