# Per-Day Cost Attribution Design

**Date:** 2026-03-11
**Status:** Approved

## Problem

Analytics daily cost chart attributes all cost for a session to its `started_at` date (or `ended_at` after a recent patch). A 254-hour session dumps hundreds of dollars onto a single day, making the chart misleading.

## Solution

Add a `session_days` table populated during indexing by grouping each JSONL record's `usage` field by the local calendar date of its `timestamp`. Analytics queries read from `session_days` instead of `sessions` for the daily breakdown.

## Schema

```sql
CREATE TABLE IF NOT EXISTS session_days (
  session_id            TEXT NOT NULL,
  date                  TEXT NOT NULL,  -- YYYY-MM-DD local time (en-CA format)
  usd                   REAL NOT NULL DEFAULT 0,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, date)
);
CREATE INDEX IF NOT EXISTS idx_session_days_date ON session_days(date);
```

## Component Changes

### `packages/core/src/db.ts`
- Add `session_days` table and index to `createSchema`.

### `packages/core/src/sessions.ts`
- Add `dayMap: Map<string, TokenUsage>` to the state returned by `makeSessionState`.
- In `processRecord`, when a record has both `message.usage` and `timestamp`, compute `localDate = new Date(record.timestamp).toLocaleDateString('en-CA')` and accumulate tokens into `dayMap.get(localDate)`.
- `finalizeSession` returns a new field `dayMap` on the result (extend `ClaudeSession` or return a wrapper type).

### `packages/core/src/types.ts`
- Add `dayMap?: Map<string, TokenUsage>` to `ClaudeSession` (optional, only present after parsing).

### `packages/core/src/indexer.ts`
- After upserting a session row, delete existing `session_days` rows for that `session_id` then insert new rows from `session.dayMap` — all in the same transaction.
- Apply to both `buildIndex` (small and streamed paths) and `upsertSession` (watcher path).

### `packages/core/src/analytics.ts`
- `byDay` query reads from `session_days JOIN sessions` filtered by `sd.date BETWEEN @since AND @until`.
- Total / byProject / byModel filters also shift to use `session_days.date` range so a month-long session's cost only appears in a week report if work happened that week.

## Data Flow

```
JSONL record (timestamp + usage)
  → processRecord groups tokens by local date into dayMap
  → finalizeSession returns dayMap alongside ClaudeSession
  → indexer deletes old session_days rows, inserts new ones
  → analytics queries session_days for daily chart
```

## Migration

All `indexed_at` values were already reset to `2000-01-01` in a prior fix, so every session will be re-indexed on next app startup — no additional migration needed.
