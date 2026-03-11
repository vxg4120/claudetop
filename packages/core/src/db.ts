import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type Db = Database.Database

export function getDefaultDbPath(): string {
  const dir = path.join(os.homedir(), '.claudetop')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'sessions.db')
}

export function openDb(dbPath = getDefaultDbPath()): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  return db
}

export function closeDb(db: Db): void {
  db.close()
}

function createSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id            TEXT PRIMARY KEY,
      project_slug          TEXT NOT NULL,
      cwd                   TEXT NOT NULL DEFAULT '',
      git_branch            TEXT,
      model                 TEXT,
      started_at            TEXT,
      ended_at              TEXT,
      duration_seconds      INTEGER,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd    REAL NOT NULL DEFAULT 0,
      is_sidechain          INTEGER NOT NULL DEFAULT 0,
      parent_session_id     TEXT,
      summary               TEXT,
      permission_mode       TEXT,
      indexed_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project    ON sessions(project_slug);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp           TEXT NOT NULL DEFAULT (datetime('now')),
      feature             TEXT NOT NULL,
      input_tokens        INTEGER NOT NULL DEFAULT 0,
      output_tokens       INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd  REAL NOT NULL DEFAULT 0,
      session_id          TEXT
    );

    CREATE TABLE IF NOT EXISTS session_days (
      session_id            TEXT NOT NULL,
      date                  TEXT NOT NULL,
      usd                   REAL NOT NULL DEFAULT 0,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_session_days_date ON session_days(date);
  `)
}
