-- 009_two_uid_whitelist.sql
-- 有物 ERP 前端改版 M1 權限基建 — 雙 uid 白名單（Joan + 彣錩 同權）
-- 對應：有物ERP_前端改版_PRD_v1.md § 7.0（Q3 拍板「跟我一樣就可以、都要」，不做 role 分層/欄位遮蔽）
--
-- 背景（008_authenticated_rls.sql 已完成的部分）：
--   18 張業務表 RLS 已全數 ENABLE，authenticated policy 綁死 Joan 一人的 uid
--   （FOR ALL ... USING (auth.uid() = joan_uid)）。
--
-- 本次變更：18 張表的 joan_authenticated_only policy 改寫為雙 uid 白名單，
--   兩帳號完全同權（USING/WITH CHECK 皆用 auth.uid() IN (joan_uid, wenchang_uid)）。
--   Policy 名稱同步改為 authenticated_whitelist 反映語意（原 joan_authenticated_only 先 DROP）。
--
-- 不動：anon 拒讀狀態（0 policy，demo 站安全紅線）／inventory_ledger 防竄改 trigger（007）／
--   views（已 security_invoker=true，底層表 policy 通了 view 自然通，不需要對 view 另建 policy）。
--
-- Joan 專用帳號：qiongan0208@gmail.com，uid = d1bcb4cc-5619-42be-a194-16ab9a2a9dba
-- 彣錩專用帳號：qiongan0208+wenchang@gmail.com，uid = 9f9645f9-907d-4bde-87f6-2bfb1b59bb47
--（憑證/密碼另存 [[敏感憑證總表]]，不進 repo）

DO $$
DECLARE
  joan_uid CONSTANT uuid := 'd1bcb4cc-5619-42be-a194-16ab9a2a9dba';
  wenchang_uid CONSTANT uuid := '9f9645f9-907d-4bde-87f6-2bfb1b59bb47';
  t text;
  tables CONSTANT text[] := ARRAY[
    'ad_costs',
    'competitor_products',
    'consolidated_shipment_items',
    'consolidated_shipments',
    'domestic_logistics',
    'domestic_logistics_items',
    'inventory_ledger',
    'operating_expenses',
    'product_selections',
    'product_variants',
    'products',
    'purchase_order_items',
    'purchase_orders',
    'receiving_record_items',
    'receiving_records',
    'sales_order_items',
    'sales_orders',
    'stock_snapshots'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS joan_authenticated_only ON public.%I;', t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_whitelist ON public.%I;', t
    );
    EXECUTE format(
      'CREATE POLICY authenticated_whitelist ON public.%I
         FOR ALL TO authenticated
         USING (auth.uid() IN (%L::uuid, %L::uuid))
         WITH CHECK (auth.uid() IN (%L::uuid, %L::uuid));',
      t, joan_uid, wenchang_uid, joan_uid, wenchang_uid
    );
  END LOOP;
END $$;
