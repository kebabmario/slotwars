-- Finished online matches (Phase 3). Written once per match by its MatchRoom; idempotent on id.
-- Ratings join in a later phase. Full action logs are kept 90 days (decision H), summaries forever.
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,                    -- 'private' (invite code); 'ranked' later
  invite_code TEXT,
  config TEXT NOT NULL,                  -- JSON: fog, kings
  rules_version INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  winner_seat INTEGER,                   -- null for a draw or an abandoned match
  result TEXT NOT NULL,                  -- king | draw | resign | forfeit | abandoned
  rated INTEGER NOT NULL DEFAULT 0,      -- 0 for private, abandoned or server-interrupted matches
  turns INTEGER NOT NULL,
  action_log TEXT                        -- JSON [[seat, action], ...]; cleared after 90 days
);
CREATE INDEX matches_finished ON matches(finished_at);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  king_ability TEXT NOT NULL,
  king_name TEXT NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_players_user ON match_players(user_id, match_id);
