-- Plan catalogue as data (produktspecifikation §11, PLAN.md §6 Q1). No plan logic in code.
-- Entitlement values are JSON numbers; JSON null means unlimited.
-- FOLLOW-UP items are provisional product-owner answers that must be revisited before launch.
INSERT INTO plans (id, name, price_monthly_ore, sort_order) VALUES
  ('startup',    'Startup',     7900, 1),
  ('business',   'Business',   15900, 2),
  ('enterprise', 'Enterprise', 29900, 3)
ON CONFLICT (id) DO UPDATE SET name = excluded.name, price_monthly_ore = excluded.price_monthly_ore,
  sort_order = excluded.sort_order;
--> statement-breakpoint
INSERT INTO plan_entitlements (plan_id, key, value) VALUES
  ('startup',    'integration_sets',          '1'),
  ('business',   'integration_sets',          '2'),
  ('enterprise', 'integration_sets',          'null'),
  ('startup',    'destinations_per_flow',     '3'),
  ('business',   'destinations_per_flow',     '3'),
  ('enterprise', 'destinations_per_flow',     'null'),
  ('startup',    'transactions_per_month',    '100'),
  ('business',   'transactions_per_month',    '1000'),
  ('enterprise', 'transactions_per_month',    '2000'),
  ('startup',    'seats',                     '2'),
  ('business',   'seats',                     '3'),
  ('enterprise', 'seats',                     'null'),
  ('startup',    'polling_interval_minutes',  '15'),
  ('business',   'polling_interval_minutes',  '5'),
  ('enterprise', 'polling_interval_minutes',  '1'),
  -- FOLLOW-UP: retention per plan is undecided (PLAN.md Q3); spec values for all plans.
  ('startup',    'payload_retention_days',    '30'),
  ('business',   'payload_retention_days',    '30'),
  ('enterprise', 'payload_retention_days',    '30'),
  ('startup',    'run_history_months',        '13'),
  ('business',   'run_history_months',        '13'),
  ('enterprise', 'run_history_months',        '13'),
  ('startup',    'audit_retention_months',    '24'),
  ('business',   'audit_retention_months',    '24'),
  ('enterprise', 'audit_retention_months',    '24'),
  -- FOLLOW-UP: provisional overage price, 100 DKK per 1.000 transactions (PLAN.md Q1).
  ('startup',    'overage_price_ore_per_1000', '10000'),
  ('business',   'overage_price_ore_per_1000', '10000'),
  ('enterprise', 'overage_price_ore_per_1000', '10000'),
  ('startup',    'quota_grace_days',          '7'),
  ('business',   'quota_grace_days',          '7'),
  ('enterprise', 'quota_grace_days',          '7')
ON CONFLICT (plan_id, key) DO UPDATE SET value = excluded.value;
