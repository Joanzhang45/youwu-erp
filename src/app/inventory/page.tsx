"use client";

// 舊庫存管理頁退場（M5，PRD §2.3 #04）。165 項全量長牆已被 /stock 的搜尋優先＋
// 盤點模式取代；舊頁 `?filter=` 從未真正被讀取（舊碼內部用 state 不是 URL），不需要轉接。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function InventoryPage() {
  return <RedirectStub resolve={() => "/stock"} />;
}
