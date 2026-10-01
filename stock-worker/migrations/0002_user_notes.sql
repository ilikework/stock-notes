CREATE TABLE IF NOT EXISTS picks (
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
CREATE TABLE IF NOT EXISTS notes (
  user_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, session_date, session)
);
CREATE TABLE IF NOT EXISTS remarks (
  user_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  session TEXT NOT NULL,
  symbol TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_date, session, symbol)
);
CREATE TABLE IF NOT EXISTS day_journal (
  user_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_date)
);
