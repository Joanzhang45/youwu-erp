"use client";

// 舊採購明細頁退場（M5，PRD §2.3 #06）。/inbound?id= 走同一個 purchase_orders.id
// 語意（PurchaseOrderTimeline 與本頁舊碼都用 .eq("id", poId)），直接透傳 id 無需轉換。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function PurchaseDetailPage() {
  return (
    <RedirectStub
      resolve={(params) => {
        const id = params.get("id");
        return id ? `/inbound?id=${id}` : "/inbound";
      }}
    />
  );
}
