"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "首頁", icon: "🏠" },
  { href: "/products", label: "商品", icon: "🏷️" },
  { href: "/purchase", label: "採購", icon: "🛒" },
  { href: "/orders", label: "訂單", icon: "📋" },
  { href: "/analytics", label: "分析", icon: "📊" },
];

export function TabBar() {
  const pathname = usePathname();

  // Strip basePath for matching
  const cleanPath = pathname.replace(/^\/youwu-erp/, "") || "/";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-bottom">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? cleanPath === "/"
              : cleanPath.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center py-2 px-3 min-w-[56px] transition-colors ${
                isActive ? "text-blue-600" : "text-slate-400"
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className={`text-[10px] mt-0.5 ${isActive ? "font-bold" : ""}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
