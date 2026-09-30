ALTER TABLE subscriptions ADD COLUMN renewal_anchor_date TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_subscriptions_auto_end_date ON subscriptions(auto_renew,end_date);
CREATE TABLE automatic_renewal_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  previous_start_date TEXT NOT NULL,
  previous_end_date TEXT NOT NULL,
  new_start_date TEXT NOT NULL,
  new_end_date TEXT NOT NULL,
  periods_advanced INTEGER NOT NULL CHECK(periods_advanced > 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id,subscription_id) REFERENCES subscriptions(user_id,id) ON DELETE CASCADE
) STRICT;
