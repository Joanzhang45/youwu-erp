"use client";

// 舊蝦皮對應頁退場（M5，PRD §2.3 #03）。降級併入 /catalog 工具區——帶 #mapping-tool
// hash 過去，/catalog 會自動展開該區塊（見 catalog/page.tsx 的 hash 判斷）。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function ProductsMappingPage() {
  return <RedirectStub resolve={() => "/catalog#mapping-tool"} />;
}
