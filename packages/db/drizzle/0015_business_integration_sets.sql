-- Business has no cap on integration sets: D13-Abonnement shows "Integrationssæt 2 / alle" on
-- Business, and boards outrank the marketing site in the order of authority (PLAN.md Q1).
-- Startup stays at 1 (answered), Enterprise unlimited.
UPDATE plan_entitlements SET value = 'null' WHERE plan_id = 'business' AND key = 'integration_sets';
