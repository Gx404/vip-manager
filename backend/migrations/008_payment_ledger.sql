-- Existing scheduling events stay unconfirmed; never infer that a payment occurred.
ALTER TABLE subscription_renewal_logs ADD COLUMN payment_json TEXT CHECK(payment_json IS NULL OR json_valid(payment_json));
ALTER TABLE subscriptions ADD COLUMN rate_pending INTEGER NOT NULL DEFAULT 0 CHECK(rate_pending IN (0,1));
ALTER TABLE subscription_renewal_logs ADD COLUMN previous_rate_pending INTEGER NOT NULL DEFAULT 0 CHECK(previous_rate_pending IN (0,1));
