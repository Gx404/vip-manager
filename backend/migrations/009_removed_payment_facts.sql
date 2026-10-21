-- Keep valid schedule history and excluded intervals, never canceled charge details.
CREATE TABLE subscription_billing_facts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
  PRIMARY KEY(user_id,id)
) STRICT;
CREATE INDEX idx_billing_facts_subscription ON subscription_billing_facts(user_id,subscription_id);
