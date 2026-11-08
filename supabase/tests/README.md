# 資料庫測試

每個 `.sql` 檔在**同一個交易**裡跑完後整筆撤銷，用 `ASSERT` 比對算錢、庫存的結果，任何一條不符就失敗。

- CI（`.github/workflows/deploy.yml`）：在全新的 Postgres 17 上先跑 `supabase/ci/platform_stub.sql`、`supabase/schema.sql`，再跑這裡每個檔，全過才部署。
- 本機對線上試跑也可以（一律撤銷、不留資料）：`DATABASE_URL=... python scripts/run_sql_tests.py`
- 測試資料的編號都用 `TEST-CI-` 開頭，不會撞到真資料。
