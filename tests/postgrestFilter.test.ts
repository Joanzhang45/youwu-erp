// 搜尋字串跳脫、登入後導回路徑（第二次健檢 #27）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ilikeAny, safeNextPath } from "../src/lib/postgrestFilter.ts";

test("搜尋字串用雙引號包住，逗號括號不會拆壞條件", () => {
  assert.equal(ilikeAny(["a", "b"], "杯墊,圓(大)"), 'a.ilike."%杯墊,圓(大)%",b.ilike."%杯墊,圓(大)%"');
});

test("雙引號與反斜線加跳脫", () => {
  assert.equal(ilikeAny(["a"], 'x"y\\z'), 'a.ilike."%x\\"y\\\\z%"');
});

test("登入後只導回站內路徑", () => {
  assert.equal(safeNextPath("/stock?id=3"), "/stock?id=3");
  assert.equal(safeNextPath(null), "/today");
  assert.equal(safeNextPath("https://evil.com"), "/today");
  assert.equal(safeNextPath("//evil.com"), "/today");
  assert.equal(safeNextPath("/\\evil.com"), "/today");
  assert.equal(safeNextPath("/\tevil"), "/today");
  assert.equal(safeNextPath("/login?next=/x"), "/today");
});
