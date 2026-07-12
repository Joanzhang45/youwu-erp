"use client";

// 舊商品主檔頁退場（M5，PRD §2.3 #02）。功能已被 /catalog 完整吃掉（搜尋優先＋分頁＋
// 蝦皮對應工具區），不再需要獨立的長牆列表頁。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function ProductsPage() {
  return <RedirectStub resolve={() => "/catalog"} />;
}
