-- Preserve the already-deployed v4 layout; original_amount_cents is the v5 source amount.
-- amount_cents remains a legacy rounded CNY equivalent, never repurposed.
ALTER TABLE subscriptions ADD COLUMN original_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(original_amount_cents >= 0);
ALTER TABLE subscriptions ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE subscriptions ADD COLUMN purchase_date TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN fx_rate_to_cny REAL NOT NULL DEFAULT 1 CHECK(fx_rate_to_cny > 0 AND fx_rate_to_cny <= 100000);
ALTER TABLE subscriptions ADD COLUMN fx_rate_date TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN fx_rate_source TEXT NOT NULL DEFAULT 'manual' CHECK(fx_rate_source IN ('manual','frankfurter'));
UPDATE subscriptions SET original_amount_cents=billing_amount_cents,currency=billing_currency,
  fx_rate_to_cny=exchange_rate_micros/1000000.0,
  purchase_date=CASE WHEN exchange_rate_date>start_date THEN exchange_rate_date ELSE start_date END,
  fx_rate_date=COALESCE(exchange_rate_date,start_date);

-- Ledger snapshots remain independent of later subscription edits/deletions.
ALTER TABLE subscription_renewal_logs ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE subscription_renewal_logs ADD COLUMN purchase_date TEXT NOT NULL DEFAULT '';
ALTER TABLE subscription_renewal_logs ADD COLUMN fx_rate_to_cny REAL NOT NULL DEFAULT 1 CHECK(fx_rate_to_cny > 0 AND fx_rate_to_cny <= 100000);
ALTER TABLE subscription_renewal_logs ADD COLUMN fx_rate_date TEXT NOT NULL DEFAULT '';
ALTER TABLE subscription_renewal_logs ADD COLUMN fx_rate_source TEXT NOT NULL DEFAULT 'manual' CHECK(fx_rate_source IN ('manual','frankfurter'));
UPDATE subscription_renewal_logs SET purchase_date=previous_start_date,fx_rate_date=previous_start_date;
