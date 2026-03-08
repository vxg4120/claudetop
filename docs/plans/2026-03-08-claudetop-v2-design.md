# claudetop v2 — Agent Productivity Monitor Design
*Date: 2026-03-08*

## Overview

claudetop v2 transforms the process monitor into an agent productivity tool — like employee productivity dashboards, but for Claude Code sessions. Surfaces cost, output summaries, and behavioral patterns. LLM-powered insights use the user's own Claude API key (already configured in `~/.claude/`). All LLM usage is audited and opt-in.

**Primary user:** Solo developer (teams deferred to v3)
**Core value:** See what your Claude agents accomplished, what they cost, and where time/money is going — with an AI standup to synthesize it all.

---

## Architecture

Extend `@claudetop/core` with 4 new modules:

```
packages/core/src/
├── sessions.ts      # parse ~/.claude/projects/ JSONL → session records
├── analytics.ts     # SQLite queries (cost, usage, aggregations)
├── insights.ts      # LLM client using ~/.claude/ API key
└── standup.ts       # standup generator (done/doing/blockers)
```

### Local SQLite DB: `~/.claudetop/sessions.db`

Synced from JSONL on startup + file-watch for live updates.

**`sessions` table:**
- sessionId, projectSlug, cwd, gitBranch, model
- startedAt, endedAt, durationSeconds
- inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens
- estimatedCostUsd (calculated: model × token counts)
- isSidechain, parentSessionId
- summary (TEXT, nullable — LLM-generated on demand)

**`llm_usage` table** (claudetop audits itself):
- timestamp, feature (standup | summary | insights)
- inputTokens, outputTokens, estimatedCostUsd
- sessionId (nullable, if summarizing a session)

### Cost Calculation

Derived from model + token counts in JSONL — pure math, no API call.

| Model | Input | Cache write | Cache read | Output |
|---|---|---|---|---|
| claude-opus-4-6 | $15/M | $18.75/M | $1.50/M | $75/M |
| claude-sonnet-4-6 | $3/M | $3.75/M | $0.30/M | $15/M |
| claude-haiku-4-5 | $0.80/M | $1/M | $0.08/M | $4/M |

### LLM Integration

- Read API key from `~/.claude/` config (same key Claude Code uses)
- All LLM calls are **explicit opt-in** — never background/automatic
- Show estimated token cost before every LLM call, require confirmation (or `--yes` flag)
- Log every call to `llm_usage` table after completion

---

## CLI Commands

```bash
# Session browsing
claudetop sessions                    # recent sessions, newest first
claudetop sessions --project cann     # filter by project slug
claudetop sessions --since 7d         # last 7 days
claudetop sessions <sessionId>        # full session detail

# Cost & usage reports (no LLM)
claudetop report                      # this week by default
claudetop report --period month       # monthly breakdown
claudetop report --project cann       # per-project

# LLM-powered (all show token cost + confirmation before running)
claudetop standup                     # done / doing / blockers per project
claudetop insights                    # pattern analysis
claudetop summarize <sessionId>       # summarize one session's conversation

# Maintenance
claudetop prune                       # find orphaned sessions, stale tmp files
claudetop index --rebuild             # force re-index from JSONL
```

`--json` flag available on all commands. `--yes` skips LLM cost confirmation.

---

## Electron App Additions

Three new sidebar sections added to the existing Live view:

```
sidebar
─────────────────
— Live —
  All (3)
  Runaway (1)

— History —
  Sessions
  Analytics

— Agent AI —
  Standup    ✨
  Insights   ✨
```

**Sessions panel** — searchable/filterable table of past sessions (project, date range, model). Click → detail view with token breakdown, git branch, duration, inline "Summarize" button (shows cost estimate before running).

**Analytics panel** — charts from SQLite, no LLM:
- Daily cost sparkline
- Cost by project (bar chart)
- Model distribution
- Busiest hours heatmap

**Standup panel** — "Generate Standup" button shows estimated token cost before confirming. Output: done/doing/blockers per project. Cached with timestamp, re-generate button. Format mirrors a daily standup report.

✨ = LLM-powered. Token cost shown before + after every generation.

---

## Agent Standup Format

```
📋 Agent Standup — March 8, 2026

✅ Done (last 24h)
  cann       Refactored Kafka consumer timeout handling, fixed 2 bugs, 3 commits
  claudetop  Implemented v2 design doc, scaffolded SQLite indexer

🔄 In Progress (right now)
  cann       1 session running — 47m, claude-sonnet-4-6, branch: feat/hemp-pipeline

⚠️  Blockers / Anomalies
  cann       1 runaway session (2h 13m, no recent git activity)

💰 Cost: standup used ~1,200 tokens ($0.004)
```

---

## Tech Stack Additions

| Component | Technology |
|---|---|
| Local DB | `better-sqlite3` (sync, no async complexity) |
| File watching | `chokidar` (watch `~/.claude/projects/` for new JSONL entries) |
| Charts (app) | `recharts` (React charting, already in React ecosystem) |
| LLM client | Anthropic SDK (`@anthropic-ai/sdk`) |

---

## What's Out of Scope (v2)

- Team/multi-user sync (v3)
- Scheduled digests / notifications (v3)
- Plugin system for custom metrics (v3)
- Resume/cancel sessions from UI (separate feature)
