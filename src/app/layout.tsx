import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/providers/AuthProvider";
import { SwUpdater } from "@/components/SwUpdater";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://meal.posan.kr"),
  title: {
    default: "PosanMeal — 포산고 석식 관리",
    template: "%s | PosanMeal",
  },
  description: "포산고등학교 Smart QR 석식 관리 시스템",
  applicationName: "PosanMeal",
  keywords: ["포산고", "석식", "QR", "체크인", "PosanMeal"],
  authors: [{ name: "포산고등학교" }],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "PosanMeal",
    title: "PosanMeal — 포산고 석식 관리",
    description: "포산고등학교 Smart QR 석식 관리 시스템",
  },
  twitter: {
    card: "summary_large_image",
    title: "PosanMeal — 포산고 석식 관리",
    description: "포산고등학교 Smart QR 석식 관리 시스템",
  },
  appleWebApp: {
    capable: true,
    title: "PosanMeal",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
        <SwUpdater />
      </body>
    </html>
  );
}
