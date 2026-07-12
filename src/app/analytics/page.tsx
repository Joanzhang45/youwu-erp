"use client";

// 舊數據分析頁退場（M5，PRD §2.3 #11）。功能已由 /insights 完整取代（預設本月＋
// Top/Bottom 排行＋自訂區間）。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function AnalyticsPage() {
  return <RedirectStub resolve={() => "/insights"} />;
}
