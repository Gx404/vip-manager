CREATE TABLE subscription_renewal_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  subscription_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('manual','automatic')),
  previous_start_date TEXT NOT NULL,
  previous_end_date TEXT NOT NULL,
  new_start_date TEXT NOT NULL,
  new_end_date TEXT NOT NULL,
  previous_anchor_date TEXT NOT NULL,
  new_anchor_date TEXT NOT NULL,
  amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents >= 0),
  periods INTEGER NOT NULL CHECK(periods > 0),
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  resulting_version INTEGER,
  undo_until INTEGER,
  request_id TEXT,
  PRIMARY KEY(user_id,id),
  UNIQUE(user_id,request_id)
) STRICT;
CREATE INDEX idx_renewal_logs_owner_time ON subscription_renewal_logs(user_id,created_at DESC,id);
CREATE INDEX idx_renewal_logs_subscription ON subscription_renewal_logs(user_id,subscription_id,created_at DESC);

-- Preserve pre-v3 automatic audits without inventing the amount charged at that time.
INSERT INTO subscription_renewal_logs (
  user_id,id,subscription_id,subscription_name,kind,previous_start_date,previous_end_date,
  new_start_date,new_end_date,previous_anchor_date,new_anchor_date,amount_cents,periods,created_at
)
SELECT e.user_id,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  e.subscription_id,s.name,'automatic',e.previous_start_date,e.previous_end_date,e.new_start_date,e.new_end_date,
  e.previous_start_date,e.new_start_date,NULL,e.periods_advanced,e.created_at
FROM automatic_renewal_events e JOIN subscriptions s ON s.user_id=e.user_id AND s.id=e.subscription_id;
