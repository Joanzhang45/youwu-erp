// node --test 直接跑（Node 22.18+／24 內建去型別）。測錯誤訊息翻譯（第二次健檢 #19）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError, messageOf } from "../src/lib/friendlyError.ts";

test("資料庫代號翻成中文", () => {
  assert.equal(friendlyError({ message: "ALREADY_RECEIVED" }), "這批貨已經點收過了，不能重複點收");
  assert.equal(friendlyError(new Error("PO_CLOSED PO-20260718-001")), "這張採購單已經結案了");
  // NO_ITEMS_LEFT 要先比對，不能被 NO_ITEMS 吃掉
  assert.equal(friendlyError({ message: "NO_ITEMS_LEFT" }), "這張採購單已經沒有可以再排的數量");
  assert.equal(friendlyError({ message: "NO_ITEMS" }), "至少要有一個品項");
  assert.equal(friendlyError({ message: "LEDGER_NO_DELETE 庫存紀錄不能刪除" }), "庫存紀錄不能刪除，記錯了請用入庫或出庫補一筆反向的");
});

test("常見英文錯誤翻成中文", () => {
  assert.match(friendlyError(new TypeError("Failed to fetch")), /網路連不上/);
  assert.match(friendlyError({ message: "JWT expired" }), /登入已經過期/);
  assert.match(friendlyError({ message: 'new row violates row-level security policy for table "products"' }), /沒有權限/);
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "x"' }), /相同的資料/);
});

test("本來就是中文的訊息原樣顯示", () => {
  assert.equal(friendlyError("匯率要填 3 到 10 之間的數字"), "匯率要填 3 到 10 之間的數字");
});

test("認不出的英文：中文開頭＋附技術訊息", () => {
  const t = friendlyError({ message: "something odd happened" }, "載入失敗");
  assert.equal(t, "載入失敗（技術訊息：something odd happened）");
});

test("空的錯誤給預設中文", () => {
  assert.equal(friendlyError(null), "操作失敗，資料沒有寫入，可以再試一次");
  assert.equal(friendlyError({}, "載入失敗"), "載入失敗");
  assert.equal(messageOf(42), "");
});
