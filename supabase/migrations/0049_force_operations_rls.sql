-- AMA EDU 0049 — ensure operational and billing tables remain RLS-enforced
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_plans', 'school_subscriptions', 'school_billing_invoices',
    'school_invoice_items', 'school_invoice_payments', 'billing_events',
    'school_usage_snapshots', 'platform_alerts', 'platform_maintenance',
    'platform_service_status'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
