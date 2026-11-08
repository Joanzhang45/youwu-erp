-- 020_ledger_actor_and_no_delete.sql
-- 第二次健檢 #22：看得出庫存是誰改的、庫存紀錄不能被刪。
--
-- 1. inventory_ledger.created_by：寫入當下的登入者（auth.uid()）。網頁上的入庫／出庫、點收、盤點、
--    改對應都會帶到登入者；每月匯入腳本用資料庫帳號直連，沒有登入者 → 留空，畫面顯示「系統」。
--    舊資料一律留空（當時沒有記，不回填猜測值）。
-- 2. app_users：uid → 顯示名稱（瓊安、彣錩），畫面用來把 created_by 換成名字。
--    uid 沿用 009 白名單（009 已公開在 repo，這裡不新增 email）。
-- 3. 擋 DELETE：007 當初保留刪除口，現在改成預設不能刪。真的要清測試資料時，在同一個交易裡先
--    SET LOCAL youwu.allow_ledger_delete = 'on' 再刪；網頁登入身分另外收回 DELETE 權限。

-- ---------- 1. created_by ----------
ALTER TABLE inventory_ledger
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

COMMENT ON COLUMN inventory_ledger.created_by IS
  '寫入這筆異動的登入者（auth.uid()）；NULL＝匯入腳本等系統寫入，或 2026-11-08 以前的舊紀錄';

-- 007 的防竄改 trigger 也要擋 created_by 被改
CREATE OR REPLACE FUNCTION trg_inventory_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.movement_type IS DISTINCT FROM OLD.movement_type
     OR NEW.qty_delta IS DISTINCT FROM OLD.qty_delta
     OR NEW.ref_type IS DISTINCT FROM OLD.ref_type
     OR NEW.ref_no IS DISTINCT FROM OLD.ref_no
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION '帳本不可修改，錯帳請新增反向沖銷列（manual_adjust）';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- 2. app_users ----------
CREATE TABLE IF NOT EXISTS app_users (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_whitelist ON app_users;
CREATE POLICY authenticated_whitelist ON app_users
  FOR SELECT TO authenticated
  USING (auth.uid() IN ('d1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid, '9f9645f9-907d-4bde-87f6-2bfb1b59bb47'::uuid));

REVOKE ALL ON app_users FROM anon, authenticated;
GRANT SELECT ON app_users TO authenticated;

INSERT INTO app_users (user_id, display_name) VALUES
  ('d1bcb4cc-5619-42be-a194-16ab9a2a9dba', '瓊安'),
  ('9f9645f9-907d-4bde-87f6-2bfb1b59bb47', '彣錩')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- ---------- 3. 擋 DELETE ----------
CREATE OR REPLACE FUNCTION trg_inventory_ledger_no_delete() RETURNS TRIGGER AS $$
BEGIN
  IF coalesce(current_setting('youwu.allow_ledger_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'LEDGER_NO_DELETE 庫存紀錄不能刪除，記錯請新增反向沖銷列（manual_adjust）';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_ledger_no_delete ON inventory_ledger;
CREATE TRIGGER trg_inventory_ledger_no_delete
BEFORE DELETE ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION trg_inventory_ledger_no_delete();

REVOKE DELETE, TRUNCATE ON inventory_ledger FROM anon, authenticated;

COMMENT ON TABLE inventory_ledger IS
  '庫存帳本（append-only）。不能改（trg_inventory_ledger_no_update，只放行 note）、不能刪（trg_inventory_ledger_no_delete；清測試資料時同一交易先 SET LOCAL youwu.allow_ledger_delete = ''on''）。錯帳一律新增反向沖銷列。created_by＝寫入的登入者，NULL＝系統匯入或 2026-11-08 前舊資料。';
