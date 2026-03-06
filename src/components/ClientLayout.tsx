"use client";

import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { TabBar } from "./TabBar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="pb-16">{children}</div>
        <TabBar />
      </ConfirmProvider>
    </ToastProvider>
  );
}
