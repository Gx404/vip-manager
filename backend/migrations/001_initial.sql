CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE subscription_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN (0, 1))
) STRICT;
CREATE TABLE subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  cycle TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','yearly','custom')),
  custom_days INTEGER NOT NULL CHECK(custom_days BETWEEN 1 AND 3650),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date > start_date),
  reminder_days INTEGER NOT NULL CHECK(reminder_days BETWEEN 0 AND 365),
  auto_renew INTEGER NOT NULL CHECK(auto_renew IN (0,1)),
  note TEXT NOT NULL,
  color TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,id)
) STRICT;
CREATE INDEX idx_subscriptions_owner_end_date ON subscriptions(user_id,end_date);
