"use client";

// 舊費用管理頁退場（M5，PRD §2.3 #10）。功能已由 /spend 完整取代。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function ExpensesPage() {
  return <RedirectStub resolve={() => "/spend"} />;
}
