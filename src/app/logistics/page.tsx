"use client";

// 舊境內物流頁退場（M5，PRD §2.3 #14）。在途單狀態已併入 /inbound 進貨鏈時間軸與
// 「今天」在途任務卡。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function LogisticsPage() {
  return <RedirectStub resolve={() => "/inbound"} />;
}
