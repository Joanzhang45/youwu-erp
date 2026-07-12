"use client";

// 舊首頁（8 模組卡片＋自製 QuickStats）退場（M5，PRD §2.3 #01）。
// 「今天」（/today）已完整取代：任務卡＋KPI 摘要＋最近操作，且無兩套導覽並存的 S1 病灶。
// 未登入時 /today 本身就會顯示 demo 展示模式（A11），這裡不用另外判斷。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function Home() {
  return <RedirectStub resolve={() => "/today"} />;
}
