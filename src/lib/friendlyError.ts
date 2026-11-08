// 把資料庫、網路、Supabase 回傳的英文錯誤翻成看得懂的中文（第二次健檢 #19）。
// 純函式、不 import 別的模組，CI 直接用 node --test 跑（見 tests/friendlyError.test.ts）。

// 資料庫函式自己丟的代號（RAISE EXCEPTION 'CODE ...'）→ 中文
const DB_CODES: [string, string][] = [
  ["ALREADY_RECEIVED", "這批貨已經點收過了，不能重複點收"],
  ["MISSING_WEIGHT", "這張集運單沒有填總重，運費沒辦法分攤，請先補上總重"],
  ["MISSING_COST", "這張集運單沒有填總運費，請先補上"],
  ["BAD_RATE", "人民幣匯率要填 3 到 10 之間的數字"],
  ["BELOW_SHIPPED", "叫貨數量不能比已經排進集運的數量少"],
  ["OVER_SHIPPED", "排進集運的數量超過採購單上叫的數量"],
  ["BAD_ITEM", "有品項的數量或單價不對，請檢查"],
  ["DUPLICATE_ITEM", "同一個品項重複出現了，請合併成一列"],
  ["HAS_SHIPMENTS", "這張採購單已經排過集運，不能取消"],
  ["ITEM_NOT_LINKED", "有品項還沒對應到商品，請先在採購單上選好商品"],
  ["ITEM_NOT_IN_PO", "有品項不在這張採購單裡，請重新整理後再試"],
  ["ITEM_NOT_IN_SHIPMENT", "有品項不在這張集運單裡，請重新整理後再試"],
  ["NO_ITEMS_LEFT", "這張採購單已經沒有可以再排的數量"],
  ["NO_ITEMS", "至少要有一個品項"],
  ["PO_CANCELLED", "這張採購單已經取消了"],
  ["PO_CLOSED", "這張採購單已經結案了"],
  ["PO_ITEM_NOT_FOUND", "找不到這個採購品項，可能已被刪除，請重新整理"],
  ["PO_LOCKED", "這張採購單已經有貨在路上或點收過，不能這樣改"],
  ["PO_NOT_FOUND", "找不到這張採購單，可能已被刪除，請重新整理"],
  ["PO_RECEIVED", "這張採購單已經點收過，不能取消"],
  ["PRODUCT_NOT_FOUND", "找不到這個商品，可能已被刪除，請重新整理"],
  ["SHIPMENT_NOT_FOUND", "找不到這張集運單，可能已被刪除，請重新整理"],
  ["LEDGER_NO_DELETE", "庫存紀錄不能刪除，記錯了請用入庫或出庫補一筆反向的"],
];

// 一般英文錯誤 → 中文（比對不分大小寫）
const GENERIC: [RegExp, string][] = [
  [/statement timeout|canceling statement/i, "資料庫處理太久被中止，資料沒有寫入，請再試一次"],
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out/i, "網路連不上，資料沒有寫入，請確認網路後再試一次"],
  [/jwt expired|invalid jwt|refresh token|not authenticated|auth session missing/i, "登入已經過期，請重新登入"],
  [/row-level security|permission denied|42501/i, "這個帳號沒有權限做這件事"],
  [/duplicate key|unique constraint|23505/i, "已經有一筆相同的資料了，不用重複新增"],
  [/violates check constraint|23514/i, "有數字不符合規則（例如負數或超出範圍），請檢查後再試"],
  [/violates foreign key|23503/i, "這筆資料還有其他紀錄在用，不能這樣改或刪"],
  [/violates not-null|null value in column|23502/i, "有必填的欄位沒填"],
  [/invalid input syntax|22P02/i, "有欄位的格式不對（例如數字欄位打了文字）"],
  [/value too long|22001/i, "有欄位的字太長了"],
  [/out of range|22003/i, "有數字太大或太小，超出可以存的範圍"],
];

const HAS_CJK = /[㐀-鿿]/;

export function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message ?? "");
  return "";
}

// fallback：認不出來的錯誤要顯示的中文開頭
export function friendlyError(e: unknown, fallback = "操作失敗，資料沒有寫入，可以再試一次"): string {
  const raw = messageOf(e).trim();
  if (!raw) return fallback;
  for (const [code, text] of DB_CODES) if (raw.includes(code)) return text;
  for (const [re, text] of GENERIC) if (re.test(raw)) return text;
  if (HAS_CJK.test(raw)) return raw; // 程式自己寫的中文訊息，原樣顯示
  return `${fallback}（技術訊息：${raw.slice(0, 120)}）`;
}
