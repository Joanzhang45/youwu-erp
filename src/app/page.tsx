import Link from "next/link";

const modules = [
  { href: "/inventory", label: "庫存管理", desc: "查看庫存、出入庫", icon: "📦", ready: true },
  { href: "/products", label: "商品資訊", desc: "商品與成本管理", icon: "🏷️", ready: true },
  { href: "/purchase", label: "採購管理", desc: "採購單、物流追蹤", icon: "🛒", ready: true },
  { href: "/orders", label: "銷售訂單", desc: "蝦皮訂單匯入", icon: "📋", ready: true },
  { href: "/expenses", label: "費用管理", desc: "廣告、營業費用", icon: "💰", ready: true },
  { href: "/analytics", label: "數據分析", desc: "毛利、庫存報表", icon: "📊", ready: true },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-slate-800 text-white px-4 py-6">
        <h1 className="text-2xl font-bold">有物製所 ERP</h1>
        <p className="text-slate-300 text-sm mt-1">庫存與營運管理系統</p>
      </header>

      {/* Module Grid */}
      <main className="p-4 max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-3">
          {modules.map((m) => (
            <Link
              key={m.href}
              href={m.ready ? m.href : "#"}
              className={`block rounded-xl p-4 shadow-sm border transition-all ${
                m.ready
                  ? "bg-white border-slate-200 hover:shadow-md hover:border-blue-300 active:scale-[0.98]"
                  : "bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="text-3xl mb-2">{m.icon}</div>
              <div className="font-semibold text-sm">{m.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{m.desc}</div>
              {!m.ready && (
                <div className="text-[10px] text-slate-400 mt-1">開發中</div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
