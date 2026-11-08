"use client";

// 畫面上方的提示訊息。錯誤訊息（第二次健檢 #19）：一律過 friendlyError 翻成中文，
// 停留 8 秒、可點 × 或點訊息本身關掉；成功 2.5 秒、一般提示 4 秒。
import { useState, useCallback, useRef, createContext, useContext } from "react";
import { friendlyError } from "@/lib/friendlyError";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };

const DURATION: Record<ToastType, number> = { success: 2500, info: 4000, error: 8000 };

const ToastContext = createContext<{
  toast: (message: string, type?: ToastType) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = ++nextId.current;
      const text = type === "error" ? friendlyError(message) : message;
      setToasts((prev) => [...prev, { id, message: text, type }]);
      setTimeout(() => dismiss(id), DURATION[type]);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none w-[90%] max-w-sm"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg animate-slide-down pointer-events-auto ${
              t.type === "success"
                ? "bg-emerald-600 text-white"
                : t.type === "error"
                ? "bg-red-600 text-white"
                : "bg-slate-800 text-white"
            }`}
          >
            <span className="flex-1">
              {t.type === "success" && "✓ "}
              {t.type === "error" && "✕ "}
              {t.message}
            </span>
            {t.type === "error" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="-mr-1 -mt-0.5 w-7 h-7 flex-shrink-0 rounded-full text-lg leading-none text-white/90 hover:bg-white/20"
                aria-label="關閉訊息"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
