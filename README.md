# 有物製所 ERP

Next.js（靜態輸出）＋ Supabase。推到 `master` 後 GitHub Actions 先檢查、全過才部署到 GitHub Pages：
https://joanzhang45.github.io/youwu-erp/

## 上線前的自動檢查（`.github/workflows/deploy.yml`）

| 關卡 | 內容 |
|---|---|
| check | `npm run lint`、`npm run typecheck`、`npm test`（`tests/*.test.ts`，Node 24 直接跑） |
| db | 全新 Postgres 17 上依 `supabase/ci/platform_stub.sql` ＋ `supabase/schema.sql` 從零重建，跑 `supabase/tests/*.sql`（算錢、庫存），再匯出一次結構跟 repo 比對 |

推到其他分支也會跑檢查，但不部署。

## 改資料庫的固定步驟

1. 寫 `supabase/migrations/NNN_xxx.sql`。
2. 先在線上撤銷模式試跑：`DATABASE_URL=... python scripts/run_sql_tests.py --prelude supabase/migrations/NNN_xxx.sql`（測試一律撤銷，不留資料）。
3. 套用到線上。
4. 重新匯出結構：`DATABASE_URL=... python scripts/dump_schema.py`，把 `supabase/schema.sql` 和 `src/lib/database.generated.ts` 一起 commit。沒重匯，CI 的比對關卡會擋。

`supabase/schema.sql` 是「現在線上長怎樣」的完整快照，資料庫要從頭重建時用它，不用逐一重跑舊 migration（001 有兩版、部分舊 migration 不能重跑）。

## 腳本

- `scripts/import-shopee-monthly.py`：每月蝦皮訂單與廣告費匯入（要 `DATABASE_URL`、`SHOPEE_XLSX_PASSWORD`）。
- `scripts/dump_schema.py`：匯出結構與前端型別。
- `scripts/run_sql_tests.py`：跑資料庫測試。

2026-11-08 移除 8 支舊工具（Ragic 匯入、舊對應／重算腳本、會蓋掉正確報表定義的舊 `create_views.sql`、關掉連線安全檢查的 `qa-check.py`），要看舊內容翻 git 歷史。

## 帳號

只有白名單兩個帳號能讀寫（RLS policy `authenticated_whitelist`）。uid → 顯示名稱在 `app_users`。
