// M2 新任務導向流程（/today /receive /stock）專用字體。
// 只在新路由套用，不動全站 <body> 字體，避免影響舊 13 頁排版。
// geist 套件自帶字體檔（self-hosted，build 不需連網），對應 PRD §6 Vercel/Geist 設計語言。
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export { GeistSans, GeistMono };
