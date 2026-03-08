const FILTER_STYLES: Record<string, { active: string; inactive: string }> = {
  default: { active: "bg-slate-800 text-white", inactive: "bg-slate-100 text-slate-600" },
  blue: { active: "bg-blue-500 text-white", inactive: "bg-blue-50 text-blue-700" },
  emerald: { active: "bg-emerald-500 text-white", inactive: "bg-emerald-50 text-emerald-700" },
  red: { active: "bg-red-500 text-white", inactive: "bg-red-50 text-red-700" },
};

export function FilterTab({ label, active, onClick, color }: {
  label: string; active: boolean; onClick: () => void; color?: string;
}) {
  const style = FILTER_STYLES[color || "default"] || FILTER_STYLES.default;
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? style.active : style.inactive
      }`}
    >
      {label}
    </button>
  );
}
