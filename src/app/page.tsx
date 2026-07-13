"use client";

// 舊首頁（8 模組卡片＋自製 QuickStats）退場（M5，PRD §2.3 #01）。
// 「今天」（/today）已完整取代：任務卡＋KPI 摘要＋最近操作，且無兩套導覽並存的 S1 病灶。
// M6（2026-07-14）：demo 假資料模式已全站移除，/today 本身已用 RequireAuth 擋未登入訪客，
// 這裡不用另外判斷，直接轉過去就好。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function Home() {
  return <RedirectStub resolve={() => "/today"} />;
}
