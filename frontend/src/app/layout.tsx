import { Geist, Geist_Mono } from "next/font/google";

import { AuthProvider } from "@/providers/auth-provider";
import { ConfigProvider } from "@/providers/config-provider";

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
  title: "Ragworks Control Room",
  description:
    "Observe every chunk, embedding, and token in your Retrieval-Augmented Generation stack.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-slate-50`}
      >
        <AuthProvider>
          <ConfigProvider>{children}</ConfigProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
