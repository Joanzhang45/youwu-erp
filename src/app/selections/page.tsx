"use client";

// 舊選品管理頁退場（M5，PRD §2.3 #12）。選品候選列表已收進 /inbound 首頁下半段
// （SelectionCandidatesSection）。
import { RedirectStub } from "@/components/app/RedirectStub";

export default function SelectionsPage() {
  return <RedirectStub resolve={() => "/inbound"} />;
}
