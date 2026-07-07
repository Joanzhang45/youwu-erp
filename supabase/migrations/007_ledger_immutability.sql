-- 007_ledger_immutability.sql
-- 有物 ERP Stage A Phase 2 Warning 修復 — inventory_ledger 帳本防竄改
-- 對應 PRD § 9 #6 tester Warning：「ledger 對 DB owner 直改無 trigger 擋——已加派 007 防護」
-- 帳本原則（append-only）：歷史列不可修改，錯帳一律靠新增反向沖銷列（movement_type='manual_adjust'）修正。
-- 唯一例外：只改 note 欄（其餘欄位 OLD＝NEW）視為合法備註補充維護，放行。
-- DELETE 不擋（罕見維護口保留），改用表級 COMMENT 交代刪除紀律，不建 trigger 卡 DELETE。

-- ============================================================
-- A. BEFORE UPDATE trigger：擋除 note 以外的任何欄位變更
-- ============================================================
CREATE OR REPLACE FUNCTION trg_inventory_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.movement_type IS DISTINCT FROM OLD.movement_type
     OR NEW.qty_delta IS DISTINCT FROM OLD.qty_delta
     OR NEW.ref_type IS DISTINCT FROM OLD.ref_type
     OR NEW.ref_no IS DISTINCT FROM OLD.ref_no
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '帳本不可修改，錯帳請新增反向沖銷列（manual_adjust）';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_ledger_no_update ON inventory_ledger;
CREATE TRIGGER trg_inventory_ledger_no_update
BEFORE UPDATE ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION trg_inventory_ledger_immutable();

-- ============================================================
-- B. 表級 COMMENT — DELETE 紀律說明（不建 trigger 擋 DELETE，罕見維護口保留）
-- ============================================================
COMMENT ON TABLE inventory_ledger IS
  '庫存帳本（append-only）。歷史列不可修改（trg_inventory_ledger_no_update 擋除 note 以外欄位的 UPDATE），錯帳請新增反向沖銷列。DELETE 未加 trigger 擋（保留給罕見維護場景，如清測試資料），但刪除任何正式列後必須人工核對 v_stock_current 是否需要補一筆 manual_adjust 沖銷分錄，避免庫存數悄悄失真。';
