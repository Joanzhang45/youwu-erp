import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientLayout } from "@/components/ClientLayout";

// Next.js 不會自動幫 metadata 裡的字串路徑（manifest/icons）加 basePath，
// 跟 <Link>/next/image 的行為不同；GH Pages 上不手動加會全部 404
// （2026-07-12 M2 自測 curl 驗證抓到，manifest 這行本身是既有舊碼、非本次新增）。
const basePath = process.env.GITHUB_PAGES === "true" ? "/youwu-erp" : "";

export const metadata: Metadata = {
  title: "有物製所 ERP",
  description: "有物製所庫存與營運管理系統",
  manifest: `${basePath}/manifest.json`,
  // PWA 加到主畫面圖示（M2：manifest+icons，start_url 指向 /today，見 public/manifest.json）。
  // 純新增 metadata 欄位、不影響舊頁任何可見排版。
  icons: {
    icon: `${basePath}/favicon.ico`,
    apple: `${basePath}/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: "有物ERP",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1e293b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
