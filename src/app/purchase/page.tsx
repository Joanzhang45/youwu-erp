"use client";

// 舊採購管理頁退場（M5，PRD §2.3 #05）。功能併入 /inbound 進貨鏈時間軸。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function PurchasePage() {
  return <RedirectStub resolve={() => "/inbound"} />;
}
