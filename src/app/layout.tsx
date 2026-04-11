import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://posanmeal.up.railway.app"),
  title: {
    default: "포산고-석식 관리 | Meal in Posan",
    template: "%s | 포산밀",
  },
  description: "포산고등학교 Smart QR 석식 관리 시스템",
  applicationName: "포산밀",
  keywords: ["포산고", "석식", "QR", "체크인", "Meal in Posan"],
  authors: [{ name: "포산고등학교" }],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "포산밀 — Meal in Posan",
    title: "포산고-석식 관리 | Meal in Posan",
    description: "포산고등학교 Smart QR 석식 관리 시스템",
  },
  twitter: {
    card: "summary_large_image",
    title: "포산고-석식 관리 | Meal in Posan",
    description: "포산고등학교 Smart QR 석식 관리 시스템",
  },
  appleWebApp: {
    capable: true,
    title: "포산밀",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
