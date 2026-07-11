-- 008_authenticated_rls.sql
-- 有物 ERP Stage B — Supabase Auth 單一帳號 + RLS authenticated policies
-- 對應任務：前端登入後看真實資料（雙模式：未登入 anon = demo，已登入 authenticated = 真實資料）
--
-- 背景（003_rls_enum_views.sql 已完成的部分）：
--   18 張業務表 RLS 已全數 ENABLE，且對 anon 沒有任何 policy = 預設拒（demo 站安全紅線，本次不動）。
--   本次新增的 authenticated policy 綁死 Joan 一人的 uid，即使未來多一個 authenticated 帳號也拿不到任何資料
--   （FOR ALL ... USING (auth.uid() = '<uid>'::uuid)，非泛用 USING (auth.role() = 'authenticated')）。
--
-- 不動：anon 拒讀狀態（0 policy）／inventory_ledger 防竄改 trigger（007）／views（已 security_invoker=true，
-- 底層表 policy 通了 view 自然通，不需要對 view 另建 policy）。
--
-- Joan 專用帳號：qiongan0208@gmail.com，uid = d1bcb4cc-5619-42be-a194-16ab9a2a9dba
--（憑證/密碼另存 [[敏感憑證總表]]，不進 repo）

DO $$
DECLARE
  joan_uid CONSTANT uuid := 'd1bcb4cc-5619-42be-a194-16ab9a2a9dba';
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
      'CREATE POLICY joan_authenticated_only ON public.%I
         FOR ALL TO authenticated
         USING (auth.uid() = %L::uuid)
         WITH CHECK (auth.uid() = %L::uuid);',
      t, joan_uid, joan_uid
    );
  END LOOP;
END $$;
