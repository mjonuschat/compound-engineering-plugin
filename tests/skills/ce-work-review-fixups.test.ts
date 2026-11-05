import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

setDefaultTimeout(60_000)

const script = path.join(__dirname, "../../skills/ce-work/scripts/review-fixups.py")
const roots: string[] = []
// Resolve the real interpreter up front: version-manager shims break under the scrubbed HOME.
const python = Bun.spawnSync(["python3", "-c", "import sys; print(sys.executable)"]).stdout.toString().trim()

function cleanEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  }
}

class Repo {
  dir: string
  env: Record<string, string>
  constructor() {
    const root = mkdtempSync(path.join(os.tmpdir(), "ce-fixups-test-"))
    roots.push(root)
    this.dir = path.join(root, "repo")
    this.env = cleanEnv(root)
    mkdirSync(this.dir)
    this.git("init", "-q", "-b", "main")
    this.git("config", "commit.gpgsign", "false")
  }
  git(...args: string[]): string {
    const p = Bun.spawnSync(["git", ...args], { cwd: this.dir, env: this.env })
    if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`)
    return p.stdout.toString().trim()
  }
  write(rel: string, content: string) {
    mkdirSync(path.dirname(path.join(this.dir, rel)), { recursive: true })
    writeFileSync(path.join(this.dir, rel), content)
  }
  read(rel: string): string {
    return readFileSync(path.join(this.dir, rel), "utf8")
  }
  commit(msg: string, ...files: string[]): string {
    this.git("add", ...files)
    this.git("commit", "-q", "-m", msg)
    return this.git("rev-parse", "HEAD")
  }
  tool(...args: string[]): { code: number; json: any } {
    const p = Bun.spawnSync([python, script, ...args], { cwd: this.dir, env: this.env })
    return { code: p.exitCode ?? -1, json: JSON.parse(p.stdout.toString() || "null") }
  }
}

// base: one file. unit A adds a.txt. unit B adds b.txt. All local, no remote.
function seed(): { repo: Repo; base: string; a: string; b: string } {
  const repo = new Repo()
  repo.write("base.txt", "one\ntwo\nthree\n")
  const base = repo.commit("base", "base.txt")
  repo.write("a.txt", "a1\na2\na3\na4\n")
  const a = repo.commit("feat: unit a", "a.txt")
  repo.write("b.txt", "b1\nb2\nb3\n")
  const b = repo.commit("feat: unit b", "b.txt")
  return { repo, base, a, b }
}

const entry = (json: any, p: string) => json.entries.find((e: any) => e.path === p)

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe("review-fixups plan: mapping changed lines to unit commits", () => {
  let s: ReturnType<typeof seed>
  beforeEach(() => {
    s = seed()
  })

  test("a fix to lines a unit introduced targets that unit", () => {
    s.repo.write("a.txt", "a1\nA2-fixed\na3\na4\n")
    s.repo.write("b.txt", "b1\nb2\nB3-fixed\n")
    const { json } = s.repo.tool("plan", "--base", s.base)
    expect(entry(json, "a.txt")).toMatchObject({ target: s.a, reason: "blame" })
    expect(entry(json, "b.txt")).toMatchObject({ target: s.b, reason: "blame" })
    expect(json.rewritable).toBe(true)
  })

  test("a new untracked file belongs to no commit", () => {
    s.repo.write("c.txt", "new\n")
    const { json } = s.repo.tool("plan", "--base", s.base)
    expect(entry(json, "c.txt")).toMatchObject({ target: null, reason: "new-file" })
  })

  test("a fix to code that predates the branch belongs to no commit", () => {
    s.repo.write("base.txt", "one\nTWO\nthree\n")
    const { json } = s.repo.tool("plan", "--base", s.base)
    expect(entry(json, "base.txt")).toMatchObject({ target: null, reason: "base-owned" })
  })

  test("the commit owning most changed lines wins when units share a file", () => {
    s.repo.write("a.txt", "a1\na2\na3\na4\na5-from-b\na6-from-b\n")
    const b2 = s.repo.commit("feat: unit b extends a", "a.txt")
    s.repo.write("a.txt", "a1\nX2\na3\na4\nX5\nX6\n")
    const { json } = s.repo.tool("plan", "--base", s.base)
    expect(entry(json, "a.txt").target).toBe(b2)
  })

  test("a tie between two units is ambiguous", () => {
    s.repo.write("a.txt", "a1\na2\na3\na4\na5-from-b\n")
    s.repo.commit("feat: unit b extends a", "a.txt")
    s.repo.write("a.txt", "X1\na2\na3\na4\nX5\n")
    const { json } = s.repo.tool("plan", "--base", s.base)
    expect(entry(json, "a.txt")).toMatchObject({ target: null, reason: "ambiguous" })
  })

  test("excluded paths never appear", () => {
    s.repo.write("a.txt", "a1\nfix\na3\na4\n")
    s.repo.write("wip.txt", "user work\n")
    const { json } = s.repo.tool("plan", "--base", s.base, "--exclude", "wip.txt")
    expect(json.entries.map((e: any) => e.path)).toEqual(["a.txt"])
  })

  test("a path with glob characters is matched literally", () => {
    s.repo.write("[x].txt", "new\n")
    s.repo.write("x.txt", "other\n")
    const { json } = s.repo.tool("plan", "--base", s.base, "--exclude", "x.txt")
    expect(json.entries.map((e: any) => e.path)).toEqual(["[x].txt"])
  })
})

describe("review-fixups plan: when the range may not be rewritten", () => {
  test("a commit already on a remote blocks the rewrite and is named", () => {
    const { repo, base, a } = seed()
    const remote = path.join(path.dirname(repo.dir), "remote.git")
    Bun.spawnSync(["git", "init", "-q", "--bare", remote], { env: repo.env })
    repo.git("remote", "add", "origin", remote)
    repo.git("push", "-q", "origin", `${a}:refs/heads/side`)
    repo.git("fetch", "-q", "origin")
    repo.write("a.txt", "a1\nfix\na3\na4\n")
    const { json } = repo.tool("plan", "--base", base)
    expect(json.rewritable).toBe(false)
    expect(json.blockers).toContain("pushed-commits")
    expect(json.pushed).toEqual([a])
  })

  test("a merge commit in the range blocks the rewrite", () => {
    const { repo, base } = seed()
    repo.git("checkout", "-q", "-b", "side", base)
    repo.write("s.txt", "s\n")
    repo.commit("side", "s.txt")
    repo.git("checkout", "-q", "main")
    repo.git("merge", "-q", "--no-ff", "-m", "merge side", "side")
    repo.write("a.txt", "a1\nfix\na3\na4\n")
    expect(repo.tool("plan", "--base", base).json.blockers).toContain("merge-commits")
  })

  test("a detached HEAD blocks the rewrite", () => {
    const { repo, base } = seed()
    repo.git("checkout", "-q", "--detach")
    repo.write("a.txt", "a1\nfix\na3\na4\n")
    expect(repo.tool("plan", "--base", base).json.blockers).toContain("detached-head")
  })
})

describe("review-fixups fold", () => {
  let s: ReturnType<typeof seed>
  beforeEach(() => {
    s = seed()
  })

  test("folds each fix into its unit and keeps the final tree identical", () => {
    s.repo.write("a.txt", "a1\nA2-fixed\na3\na4\n")
    s.repo.write("b.txt", "b1\nb2\nB3-fixed\n")
    s.repo.write("c.txt", "new\n")
    const before = s.repo.git("rev-parse", "HEAD")
    const { code, json } = s.repo.tool("fold", "--base", s.base, "--check", "true")
    expect(code).toBe(0)
    expect(json.status).toBe("folded")
    expect(json.old_head).toBe(before)
    const subjects = s.repo.git("log", "--format=%s", `${s.base}..HEAD`).split("\n").reverse()
    expect(subjects).toEqual(["feat: unit a", "feat: unit b", "fix(review): apply code review fixes"])
    expect(s.repo.git("show", "HEAD~2:a.txt")).toContain("A2-fixed")
    expect(s.repo.git("show", "HEAD~1:b.txt")).toContain("B3-fixed")
    expect(s.repo.git("show", "HEAD:c.txt")).toBe("new")
    expect(s.repo.git("status", "--porcelain")).toBe("")
    expect(s.repo.git("worktree", "list").split("\n")).toHaveLength(1)
  })

  test("pre-existing dirty files are left byte-for-byte alone", () => {
    s.repo.write("wip.txt", "user work\n")
    s.repo.write("base.txt", "one\ntwo\nthree\nuser edit\n")
    s.repo.write("a.txt", "a1\nfix\na3\na4\n")
    const { json } = s.repo.tool("fold", "--base", s.base, "--check", "true", "--exclude", "wip.txt", "--exclude", "base.txt")
    expect(json.status).toBe("folded")
    expect(s.repo.read("wip.txt")).toBe("user work\n")
    expect(s.repo.read("base.txt")).toBe("one\ntwo\nthree\nuser edit\n")
    const status = s.repo.git("status", "--porcelain").split("\n").sort()
    expect(status).toEqual(["?? wip.txt", "M base.txt"])
  })

  test("a failing check leaves the branch and working tree exactly as they were", () => {
    s.repo.write("a.txt", "a1\nfix\na3\na4\n")
    const head = s.repo.git("rev-parse", "HEAD")
    const status = s.repo.git("status", "--porcelain")
    const { code, json } = s.repo.tool("fold", "--base", s.base, "--check", "false")
    expect(code).toBe(1)
    expect(json).toMatchObject({ status: "failed", stage: "check" })
    expect(s.repo.git("rev-parse", "HEAD")).toBe(head)
    expect(s.repo.git("status", "--porcelain")).toBe(status)
    expect(s.repo.read("a.txt")).toBe("a1\nfix\na3\na4\n")
    expect(s.repo.git("worktree", "list").split("\n")).toHaveLength(1)
  })

  test("the check runs at each rewritten commit, not just the tip", () => {
    s.repo.write("a.txt", "a1\nfix\na3\na4\n")
    // Passes at unit a's rewritten commit (no b.txt yet), fails once b.txt exists beside the fix.
    const check = "! (test -f b.txt && grep -q fix a.txt)"
    const { json } = s.repo.tool("fold", "--base", s.base, "--check", check)
    expect(json).toMatchObject({ status: "failed", stage: "check" })
    expect(json.commit).not.toBeNull()
  })

  test("a conflicting fixup aborts the rebase and changes nothing", () => {
    // Unit b rewrites a's line 2. The fix touches lines 2-4: most are a's, so it targets a, and conflicts with b.
    s.repo.write("a.txt", "a1\nB-rewrite\na3\na4\n")
    s.repo.commit("feat: unit b rewrites a", "a.txt")
    s.repo.write("a.txt", "a1\nfix2\nfix3\nfix4\n")
    const head = s.repo.git("rev-parse", "HEAD")
    const { code, json } = s.repo.tool("fold", "--base", s.base, "--check", "true")
    expect(code).toBe(1)
    expect(json).toMatchObject({ status: "failed", stage: "rebase" })
    expect(s.repo.git("rev-parse", "HEAD")).toBe(head)
    expect(s.repo.read("a.txt")).toBe("a1\nfix2\nfix3\nfix4\n")
    expect(s.repo.git("worktree", "list").split("\n")).toHaveLength(1)
  })

  test("falls back, touching nothing, when the range has a pushed commit", () => {
    const remote = path.join(path.dirname(s.repo.dir), "remote.git")
    Bun.spawnSync(["git", "init", "-q", "--bare", remote], { env: s.repo.env })
    s.repo.git("remote", "add", "origin", remote)
    s.repo.git("push", "-q", "origin", "main")
    s.repo.write("a.txt", "a1\nfix\na3\na4\n")
    const head = s.repo.git("rev-parse", "HEAD")
    const { code, json } = s.repo.tool("fold", "--base", s.base, "--check", "true")
    expect(code).toBe(0)
    expect(json).toMatchObject({ status: "fallback" })
    expect(json.reason).toContain("pushed-commits")
    expect(s.repo.git("rev-parse", "HEAD")).toBe(head)
    expect(s.repo.read("a.txt")).toBe("a1\nfix\na3\na4\n")
  })

  test("falls back when no fix belongs to an existing commit", () => {
    s.repo.write("c.txt", "new\n")
    const { json } = s.repo.tool("fold", "--base", s.base, "--check", "true")
    expect(json).toMatchObject({ status: "fallback", reason: "no-owned-fixes" })
    expect(s.repo.git("status", "--porcelain")).toBe("?? c.txt")
  })
})
