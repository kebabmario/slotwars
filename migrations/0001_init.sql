-- Accounts and sessions (Phase 2). Later phases add their tables in new migration files.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,      -- usernames are unique ignoring case
  pass_hash TEXT NOT NULL,               -- encoded Argon2id hash, keyed with the PEPPER secret
  pass_algo TEXT NOT NULL,               -- lets a future algorithm change rehash on login
  recovery_hash TEXT,                    -- SHA-256 of the one-time recovery code, null once used
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256 of the cookie token; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
