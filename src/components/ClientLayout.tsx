"use client";

import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { TabBar } from "./TabBar";
import { AuthProvider } from "@/lib/AuthContext";
import { AuthStatusBar } from "./AuthStatusBar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthStatusBar />
          <div className="pb-16">{children}</div>
          <TabBar />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
