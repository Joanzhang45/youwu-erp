"""
run_sql_tests.py — 跑 supabase/tests/*.sql（第二次健檢 #25）。每個檔各自一個交易，跑完一律撤銷。

  DATABASE_URL=... python scripts/run_sql_tests.py                 對既有資料庫跑（線上也安全：不留資料）
  DATABASE_URL=... python scripts/run_sql_tests.py --rebuild       CI：先在空資料庫建 platform_stub + schema.sql
  ... --prelude supabase/migrations/021_x.sql                       還沒套用的 migration 先在同一個交易裡套上再測
任何 ASSERT 失敗或 SQL 錯誤 → 結束碼 1。
"""
import glob
import os
import sys

import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    args = sys.argv[1:]
    if "--rebuild" in args:
        cur = conn.cursor()
        for p in ("supabase/ci/platform_stub.sql", "supabase/schema.sql"):
            cur.execute(read(os.path.join(ROOT, p)))
            print("applied", p)
        conn.commit()
    preludes = [args[i + 1] for i, a in enumerate(args) if a == "--prelude"]
    failed = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "supabase", "tests", "*.sql"))):
        cur = conn.cursor()
        name = os.path.basename(path)
        try:
            for p in preludes:
                cur.execute(read(p))
            cur.execute(read(path))
            for n in conn.notices:
                print("  ", n.strip())
            print("PASS", name)
        except Exception as e:  # noqa: BLE001 — 印出原因後繼續跑下一個檔
            failed += 1
            print("FAIL", name, "→", str(e).strip().splitlines()[0])
        finally:
            conn.notices.clear()
            conn.rollback()
    conn.close()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
