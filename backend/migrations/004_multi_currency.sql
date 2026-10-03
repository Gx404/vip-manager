-- Keep the historical `amount_cents` column as the CNY reporting/settlement amount.
-- The original quote and the rate used for conversion are stored separately.
ALTER TABLE subscriptions ADD COLUMN billing_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(billing_amount_cents >= 0);
ALTER TABLE subscriptions ADD COLUMN billing_currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE subscriptions ADD COLUMN exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(exchange_rate_micros > 0);
ALTER TABLE subscriptions ADD COLUMN exchange_rate_date TEXT;

-- Existing records were entered as CNY. Preserve their visible amount exactly.
UPDATE subscriptions
SET billing_amount_cents=amount_cents,
    billing_currency='CNY',
    exchange_rate_micros=1000000,
    exchange_rate_date=start_date;
