CREATE TABLE email_notification_deliveries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel = 'email'),
  subscription_id TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reminder_days INTEGER NOT NULL CHECK(reminder_days BETWEEN 0 AND 365),
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  sent_at INTEGER,
  next_attempt_at INTEGER,
  claim_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,notification_key,channel)
) STRICT;
CREATE INDEX idx_email_notification_user_status ON email_notification_deliveries(user_id,status,updated_at);
CREATE TABLE email_test_attempts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  attempted_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','uncertain')),
  last_error TEXT
) STRICT;
