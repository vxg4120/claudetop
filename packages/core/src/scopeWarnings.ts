import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface ScopeWarning {
  cwd: string
  project: string
  severity: 'info' | 'warning' | 'critical'
  headline: string
  detail: string
  tokenRiskEstimate: 'low' | 'medium' | 'high' | 'very-high'
  hasClaudeIgnore: boolean
  hasGitIgnore: boolean
  gitTrackedFiles: number | null  // null if not a git repo
  readableFileCount: number       // source/text files Claude is likely to read
  fix: string
}

const READABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.cpp', '.c', '.h',
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.env',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.sh', '.bash', '.zsh', '.fish', '.sql',
])

const HIGH_NOISE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', '.cache', 'coverage'])

async function getGitTrackedCount(cwd: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'ls-files', '--cached', '--others', '--exclude-standard'], { timeout: 5000 })
    return stdout.trim().split('\n').filter(Boolean).length
  } catch { return null }
}

async function countReadableFiles(dir: string, maxDepth = 5): Promise<number> {
  let count = 0
  const queue: Array<{ p: string; depth: number }> = [{ p: dir, depth: 0 }]
  while (queue.length > 0 && count < 100_000) {
    const { p, depth } = queue.shift()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (HIGH_NOISE_DIRS.has(e.name)) continue
      if (e.isDirectory()) {
        if (depth < maxDepth) queue.push({ p: path.join(p, e.name), depth: depth + 1 })
      } else if (READABLE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        count++
      }
    }
  }
  return count
}

function assessRisk(opts: {
  hasClaudeIgnore: boolean
  hasGitIgnore: boolean
  gitTrackedFiles: number | null
  readableFileCount: number
  isGitRepo: boolean
}): {
  tokenRisk: ScopeWarning['tokenRiskEstimate']
  severity: ScopeWarning['severity']
  headline: string
  detail: string
  fix: string
} {
  const { hasClaudeIgnore, hasGitIgnore, gitTrackedFiles, readableFileCount, isGitRepo } = opts

  // .claudeignore present = risk is managed
  if (hasClaudeIgnore) {
    if (readableFileCount > 20_000) {
      return {
        tokenRisk: 'medium',
        severity: 'info',
        headline: 'Large repo with .claudeignore',
        detail: `${readableFileCount.toLocaleString()} readable files exist but .claudeignore is present. Verify it's excluding generated/vendor code.`,
        fix: 'Review .claudeignore to ensure node_modules, dist, and generated files are excluded.',
      }
    }
    return { tokenRisk: 'low', severity: 'info', headline: '', detail: '', fix: '' }
  }

  // No .claudeignore — assess based on file count and type
  if (readableFileCount > 20_000) {
    return {
      tokenRisk: 'very-high',
      severity: 'critical',
      headline: 'Very large codebase with no .claudeignore',
      detail: `${readableFileCount.toLocaleString()} source files visible to Claude with no ignore rules. Each session could load thousands of files into context, burning significant tokens.`,
      fix: 'Create .claudeignore to exclude build artifacts, vendor code, and generated files.',
    }
  }
  if (readableFileCount > 5_000) {
    return {
      tokenRisk: 'high',
      severity: 'critical',
      headline: 'Large codebase without .claudeignore',
      detail: `${readableFileCount.toLocaleString()} source files with no scope limits. Claude may read far more context than needed.${hasGitIgnore ? ' (.gitignore exists but Claude Code does not use it)' : ''}`,
      fix: 'Add .claudeignore to reduce token consumption. Start with: node_modules/, dist/, *.lock',
    }
  }
  if (readableFileCount > 1_000) {
    return {
      tokenRisk: 'medium',
      severity: 'warning',
      headline: 'No .claudeignore — moderate scope risk',
      detail: `${readableFileCount.toLocaleString()} readable files without scope limits.${isGitRepo && !hasGitIgnore ? ' No .gitignore either — Claude sees everything.' : ''}`,
      fix: 'Consider adding .claudeignore for large or auto-generated directories.',
    }
  }

  // Small repo, no claudeignore — low risk
  if (readableFileCount > 200) {
    return {
      tokenRisk: 'low',
      severity: 'info',
      headline: 'No .claudeignore',
      detail: `${readableFileCount.toLocaleString()} readable files. Risk is low but a .claudeignore can help keep context focused.`,
      fix: 'Optional: add .claudeignore to keep Claude focused on relevant files.',
    }
  }

  return { tokenRisk: 'low', severity: 'info', headline: '', detail: '', fix: '' }
}

export async function checkScopeWarning(cwd: string): Promise<ScopeWarning | null> {
  if (!cwd || !fs.existsSync(cwd)) return null

  const hasClaudeIgnore = fs.existsSync(path.join(cwd, '.claudeignore'))
  const hasGitIgnore = fs.existsSync(path.join(cwd, '.gitignore'))
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'))

  const [gitTrackedFiles, readableFileCount] = await Promise.all([
    isGitRepo ? getGitTrackedCount(cwd) : Promise.resolve(null),
    countReadableFiles(cwd),
  ])

  const assessment = assessRisk({ hasClaudeIgnore, hasGitIgnore, gitTrackedFiles, readableFileCount, isGitRepo })

  // Only surface warning/critical
  if (assessment.severity === 'info' && assessment.tokenRisk === 'low') return null

  const parts = cwd.split('/').filter(Boolean)
  const project = parts.slice(-2).join('/')

  return {
    cwd,
    project,
    severity: assessment.severity,
    headline: assessment.headline,
    detail: assessment.detail,
    tokenRiskEstimate: assessment.tokenRisk,
    hasClaudeIgnore,
    hasGitIgnore,
    gitTrackedFiles,
    readableFileCount,
    fix: assessment.fix,
  }
}

export async function checkScopeWarnings(cwds: string[]): Promise<ScopeWarning[]> {
  const unique = [...new Set(cwds.filter((c) => c && c.startsWith('/')))]
  const results = await Promise.all(unique.map(checkScopeWarning))
  return results.filter((r): r is ScopeWarning => r !== null)
}
