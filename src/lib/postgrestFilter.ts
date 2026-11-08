// 組 Supabase .or() 用的「多欄位模糊搜尋」字串（第二次健檢 #27）。
// 原本直接把使用者打的字串接進 `a.ilike.%x%,b.ilike.%x%`：打逗號、括號會被當成條件分隔而出錯。
// PostgREST 規則：值用雙引號包起來，裡面的逗號、括號、點都當一般字元；雙引號與反斜線前面要加反斜線。
// 純函式、不 import 別的模組，CI 用 node --test 跑（tests/postgrestFilter.test.ts）。
export function ilikeAny(columns: string[], term: string): string {
  const safe = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return columns.map((c) => `${c}.ilike."%${safe}%"`).join(",");
}

// 登入後要導回的頁面：只接受站內路徑，擋掉 //evil.com、/\evil.com、javascript: 這類（#27）
export function safeNextPath(raw: string | null | undefined, fallback = "/today"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  if (raw.startsWith("/login")) return fallback;
  return raw;
}
