"use client";

import { ToastProvider } from "./Toast";
import { TabBar } from "./TabBar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="pb-16">{children}</div>
      <TabBar />
    </ToastProvider>
  );
}
