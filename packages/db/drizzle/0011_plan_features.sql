-- Plan presentation as data (D13, D14-Onboarding-2): feature keys rendered through i18n
-- (plans.features.*). "excluded" items are shown struck through on the comparison cards.
INSERT INTO plan_entitlements (plan_id, key, value) VALUES
  ('startup',    'features', '{"included": ["transactions", "polling", "destinations3", "supportAudit"], "excluded": ["moreDestinations"]}'),
  ('business',   'features', '{"included": ["transactions", "polling", "destinations3", "externalUsers"], "excluded": ["moreDestinations"]}'),
  ('enterprise', 'features', '{"included": ["transactions", "polling", "moreDestinations", "sso", "whiteLabel"], "excluded": []}'),
  -- Plan recommendation in onboarding from "Ordrer pr. måned" (D14-Onboarding-1/2).
  ('startup',    'recommended_for_orders', '["0-200"]'),
  ('business',   'recommended_for_orders', '["200-1000"]'),
  ('enterprise', 'recommended_for_orders', '["1000+"]')
ON CONFLICT (plan_id, key) DO UPDATE SET value = excluded.value;
