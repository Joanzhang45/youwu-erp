"use client";

// 舊選品詳情頁退場（M5，PRD §2.3 #13）。/inbound?selection_id= 走同一個
// product_selections.id 語意（SelectionCandidateDetail 與本頁舊碼都用 .eq("id", id)），
// 參數名從 `id` 轉成 `selection_id`（/inbound 用 `id` 代表採購單、`selection_id` 代表選品候選，
// 兩者互斥見 inbound/page.tsx 的 InboundContent 判斷式）。編輯能力（狀態／備註）已在
// SelectionCandidateDetail 補齊（見死循環修復），不再需要繞回這裡。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function SelectionDetailPage() {
  return (
    <RedirectStub
      resolve={(params) => {
        const id = params.get("id");
        return id ? `/inbound?selection_id=${id}` : "/inbound";
      }}
    />
  );
}
