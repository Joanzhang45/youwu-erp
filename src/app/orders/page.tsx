"use client";

// 舊銷售訂單頁退場（M5，PRD §2.3 #09）。功能併入 /sales（CSV 匯入降級為工具區）。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function OrdersPage() {
  return <RedirectStub resolve={() => "/sales"} />;
}
