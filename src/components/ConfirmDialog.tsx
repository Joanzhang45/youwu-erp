"use client";

import { useState, createContext, useContext, useCallback } from "react";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<{ confirm: ConfirmFn }>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => handleClose(false)}
          />
          <div className="relative bg-white rounded-2xl w-full max-w-xs shadow-xl p-5 space-y-3 animate-slide-down">
            <h3 className="text-base font-bold text-slate-800">{state.title}</h3>
            {state.message && (
              <p className="text-sm text-slate-500">{state.message}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleClose(true)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  state.danger
                    ? "bg-red-600 text-white active:bg-red-700"
                    : "bg-blue-600 text-white active:bg-blue-700"
                }`}
              >
                {state.confirmText || "確認"}
              </button>
              <button
                onClick={() => handleClose(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 active:bg-slate-200"
              >
                {state.cancelText || "取消"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
