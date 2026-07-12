"use client";

// 舊集運管理頁退場（M5，PRD §2.3 #07）。集運費用統計併入 /inbound 進貨鏈時間軸。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function PurchaseShipmentsPage() {
  return <RedirectStub resolve={() => "/inbound"} />;
}
