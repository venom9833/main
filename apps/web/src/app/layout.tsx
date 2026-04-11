import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import GNB from "@/components/GNB";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-en",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "LinkDrop V3",
  description: "시리즈 자동화 파이프라인",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={montserrat.variable}>
      <head>
        {/* Pretendard — 한글 (CDN, next/font 미지원) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body style={{ paddingTop: '56px' }}>
        <GNB />
        {children}
      </body>
    </html>
  );
}
