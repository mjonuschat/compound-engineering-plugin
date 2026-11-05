import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.join(__dirname, "../..")
const read = (p: string) => readFileSync(path.join(repoRoot, p), "utf8")

const START = "<!-- review-rounds-triage:start -->"
const END = "<!-- review-rounds-triage:end -->"
const block = (p: string) => {
  const s = read(p)
  expect(s.split(START).length, `${p} has one triage block`).toBe(2)
  return s.slice(s.indexOf(START), s.indexOf(END) + END.length)
}

// The opt-in review loop is stated once per skill (a skill directory is self-contained), so the
// triage rule is duplicated. It is the shared contract that decides what gets edited, so the two
// copies must not drift.
describe("review rounds", () => {
  test("the triage rule is identical in ce-doc-review and ce-work", () => {
    const doc = block("skills/ce-doc-review/references/review-rounds.md")
    const work = block("skills/ce-work/references/review-rounds.md")
    expect(doc).toBe(work)
    expect(doc).toContain("Never fix a minor finding")
    expect(doc).toContain("Dispute** it, with a reason")
  })

  test("both loops use the existing severity scale for blocking and minor", () => {
    for (const p of ["skills/ce-doc-review/references/review-rounds.md", "skills/ce-work/references/review-rounds.md"]) {
      const s = read(p)
      expect(s, p).toContain("**Blocking** means `P0` or `P1`")
      expect(s, p).toContain("**Minor** means `P2` or `P3`")
      expect(s, p).toMatch(/Clean:.*\n2\. \*\*Converged:.*\n3\. \*\*Exhausted:/)
    }
  })

  test("each skill parses rounds:N and its config default where it is read first", () => {
    const docModes = read("skills/ce-doc-review/references/modes.md")
    expect(docModes).toContain("`doc_review_rounds`")
    expect(docModes).toContain("references/review-rounds.md")
    const workTriage = read("skills/ce-work/references/input-triage.md")
    expect(workTriage).toContain("`work_review_rounds`")
    expect(workTriage).toContain("`fixups:on`")
    expect(workTriage).toContain("In Return-to-Caller Mode both are ignored")
    expect(read("skills/ce-work/references/shipping-workflow.md")).toContain("references/review-rounds.md")
  })

  test("the code-review loop keeps ce-code-review report-only and adds only two inputs", () => {
    const modes = read("skills/ce-code-review/references/modes-and-output.md")
    expect(modes).toContain("| `depth:focused` |")
    expect(modes).toContain("| `decisions:<path>` |")
    expect(modes).toContain("whether the gate chose it or `depth:full` was also passed")
    expect(read("skills/ce-code-review/references/select-and-route.md")).toContain("always when `depth:focused` was passed")
    expect(read("skills/ce-code-review/references/intent-and-plan.md")).toContain("`decisions:<path>`")
    const loop = read("skills/ce-work/references/review-rounds.md")
    expect(loop).toContain("`depth:focused`")
    expect(loop).toContain("`decisions:<path>`")
    expect(loop).not.toContain("apply:local")
  })

  test("both config keys are documented in the template, its copy, and the configuration guide", () => {
    for (const p of [
      "skills/ce-setup/references/config-template.yaml",
      ".compound-engineering/config.example.yaml",
      "docs/guides/configuration.md",
    ]) {
      const s = read(p)
      expect(s, p).toContain("doc_review_rounds")
      expect(s, p).toContain("work_review_rounds")
    }
    expect(read("docs/guides/ce-doc-review.md")).toContain("rounds:N")
    expect(read("docs/guides/ce-work.md")).toContain("fixups:on")
  })

  test("history rewriting is never reachable from config or return-to-caller", () => {
    expect(read("skills/ce-setup/references/config-template.yaml")).not.toMatch(/^#?\s*\w*fixup\w*:/m)
    expect(read("skills/ce-work/references/return-to-caller.md")).not.toContain("review-fixups")
  })
})
