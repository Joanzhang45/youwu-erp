"use client";

// 舊驗收入庫頁退場（M5，PRD §2.3 #08）。/receive 是取代它的到貨點收核心流程（PRD §4.2），
// `shipment_id` 參數名與語意完全相同（都是 consolidated_shipments.id），直接透傳。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function PurchaseReceivingPage() {
  return (
    <RedirectStub
      resolve={(params) => {
        const shipmentId = params.get("shipment_id");
        return shipmentId ? `/receive?shipment_id=${shipmentId}` : "/receive";
      }}
    />
  );
}
