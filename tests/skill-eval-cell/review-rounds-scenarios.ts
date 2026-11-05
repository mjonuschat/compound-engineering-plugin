import type { Scenario } from "./catalog"

const FIX = "tests/skill-eval-cell/fixtures"
const PLAIN = `${FIX}/review-rounds-plain`
const CONFIG = `${FIX}/review-rounds-config`
const base = { cohort: "untouched", key_behavior: "judgment", read_only: true, git_init: true, post_only: true } as const
const STOP = "Resolve only this decision as the skill defines it, then stop. Do not review, dispatch, edit, or invoke another skill."

const doc = (id: string, fixture: string, args: string, rounds: string, why: string): Scenario => ({
  ...base,
  id: `ce-doc-review/rounds-${id}`,
  skill: "ce-doc-review",
  fixture,
  why,
  pre_contract: "No round count exists before this change; every run is a single review.",
  task: `Use ce-doc-review with the arguments: ${args}. ${STOP} Include exactly one line \`REVIEW_ROUNDS: <n>\` giving the review round count this run resolves (\`0\` when the argument turned the loop off), or \`REVIEW_ROUNDS: none\` when no source set a count.`,
  grade: { declared: { REVIEW_ROUNDS: rounds }, actions: "none", delegates: "none" },
})

const work = (id: string, fixture: string, input: string, expected: Record<string, string>, why: string): Scenario => ({
  ...base,
  id: `ce-work/rounds-${id}`,
  skill: "ce-work",
  fixture,
  why,
  pre_contract: "No round count or fixup switch exists before this change.",
  task: `Use ce-work with the input: ${input}. ${STOP} Include exactly one line \`REVIEW_ROUNDS: <n or none>\` for the review round count this run resolves (\`0\` when the argument turned the loop off, \`none\` when no source set a count), and exactly one line \`HISTORY_REWRITE: <on|off|ignored>\` for whether history rewriting will run (ignored means the token was given and not honored).`,
  grade: { declared: expected, actions: "none", delegates: "none" },
})

export const REVIEW_ROUNDS_SCENARIOS: Scenario[] = [
  doc("arg-wins-over-config", CONFIG, "rounds:2 docs/plans/example-plan.md", "2", "An explicit rounds:N argument outranks the config default."),
  doc("config-default-applies", CONFIG, "mode:non-interactive docs/plans/example-plan.md", "3", "doc_review_rounds applies with no argument, including to a non-interactive pipeline call."),
  doc("zero-turns-loop-off", CONFIG, "rounds:0 docs/plans/example-plan.md", "0", "rounds:0 switches the loop off for one run even when config sets a default."),
  doc("invalid-arg-continues-to-config", CONFIG, "rounds:9 docs/plans/example-plan.md", "3", "A value outside 0-5 is ignored and the next source decides, not the invalid value and not a stop."),
  doc("default-is-no-loop", PLAIN, "docs/plans/example-plan.md", "none", "Without the argument or a config key the review is a single pass, as today."),
  {
    ...base,
    id: "ce-doc-review/rounds-converged-on-returning-dispute",
    skill: "ce-doc-review",
    fixture: PLAIN,
    why: "A blocking finding the agent disputed in round 1 comes back with unchanged evidence in round 2. That is the convergence signal; the loop must not argue it a second time or run to exhaustion.",
    pre_contract: "No loop exists; there is no stop rule.",
    task: `Use ce-doc-review with rounds:4 docs/plans/example-plan.md. Read references/review-rounds.md. Round 1 produced one P1 finding, 'Retry counter resets on restart', which you disputed because nothing in the plan restarts a delivery. You fixed nothing. Round 2 raised the same P1 again with the same quoted evidence, and R29 suppressed it. Round 2 has no other blocking finding. Decide how the loop proceeds and stop. Include exactly one line \`LOOP: <clean|converged|exhausted|continue>\`.`,
    grade: { declared: { LOOP: "converged" }, files_read_post: ["references/review-rounds.md"], actions: "none", delegates: "none" },
  },
  {
    ...base,
    id: "ce-doc-review/rounds-clean-on-minor-only",
    skill: "ce-doc-review",
    fixture: PLAIN,
    why: "Only P2 and P3 findings are left after round 1. Minor findings never keep the loop running and are never fixed.",
    pre_contract: "No loop exists; there is no stop rule.",
    task: `Use ce-doc-review with rounds:3 docs/plans/example-plan.md. Read references/review-rounds.md. Round 1 returned one P2 finding about heading wording and one P3 finding about a missing example. Decide how the loop proceeds and stop. Include exactly one line \`LOOP: <clean|converged|exhausted|continue>\` and exactly one line \`MINOR_FIXED: <yes|no>\`.`,
    grade: { declared: { LOOP: "clean", MINOR_FIXED: "no" }, files_read_post: ["references/review-rounds.md"], actions: "none", delegates: "none" },
  },
  {
    ...base,
    id: "ce-doc-review/rounds-triage-three-findings",
    skill: "ce-doc-review",
    fixture: PLAIN,
    why: "Triage separates a real reachable defect, a theoretical one with no trigger, and a minor one, instead of fixing all or none.",
    pre_contract: "No loop exists; findings are routed by synthesis alone.",
    task: `Use ce-doc-review with rounds:3 docs/plans/example-plan.md. Read references/review-rounds.md. Round 1 returned three findings, and you verified each against the plan. A: P1 'U1 stops at five attempts but the plan never says whether the fifth failure is retried' (the verification line contradicts the goal on a normal delivery). B: P1 'Two workers could increment the counter at the same instant' (the plan runs one worker and names no concurrent path). C: P3 'Goal paragraph could mention logging'. Triage each and stop. Include exactly one line for each of \`TRIAGE_A: <fix|dispute|defer|record>\`, \`TRIAGE_B: <fix|dispute|defer|record>\`, \`TRIAGE_C: <fix|dispute|defer|record>\`.`,
    grade: { declared: { TRIAGE_A: "fix", TRIAGE_B: "dispute", TRIAGE_C: "record" }, files_read_post: ["references/review-rounds.md"], actions: "none", delegates: "none" },
  },
  work("config-default-applies", CONFIG, "docs/plans/example-plan.md", { REVIEW_ROUNDS: "3", HISTORY_REWRITE: "off" }, "work_review_rounds applies to a standalone run; history rewriting stays off without fixups:on."),
  work("return-to-caller-ignores-loop", CONFIG, "mode:return-to-caller rounds:3 fixups:on docs/plans/example-plan.md", { REVIEW_ROUNDS: "none", HISTORY_REWRITE: "ignored" }, "The caller owns review in return-to-caller mode, so neither the argument nor the config default starts a loop or a rewrite."),
  work("fixups-without-rounds-ignored", PLAIN, "fixups:on docs/plans/example-plan.md", { REVIEW_ROUNDS: "none", HISTORY_REWRITE: "ignored" }, "History rewriting is only meaningful with a loop; a bare fixups:on must not rewrite anything."),
  work("arg-wins-over-config", CONFIG, "rounds:0 docs/plans/example-plan.md", { REVIEW_ROUNDS: "0", HISTORY_REWRITE: "off" }, "rounds:0 switches the configured loop off for one run."),
  {
    ...base,
    id: "ce-work/rounds-review-invocation",
    skill: "ce-work",
    fixture: PLAIN,
    why: "The re-review must run through ce-code-review's own route, report-only, requiring the peer read, with the history file, over the whole branch plus fixes.",
    pre_contract: "ce-work runs one review with mode:agent and no loop.",
    task: `Use ce-work with rounds:3 docs/plans/example-plan.md. Implementation and local verification are done and you are at the shipping review. Read references/shipping-workflow.md and the file it sends you to for the loop. Round 2 is about to start. Do not run it. Include exactly one line \`REVIEW_ARGS: <the arguments you would pass ce-code-review for round 2, space separated, with <path> for any file path and <merge-base> for the base>\`.`,
    grade: {
      must_include_any: [["REVIEW_ARGS:"]],
      declared: {},
      must_include: ["mode:agent", "depth:focused", "base:<merge-base>", "decisions:<path>"],
      must_exclude: ["apply:local", "mode:autofix"],
      files_read_post: ["references/review-rounds.md"],
      actions: "none",
      delegates: "none",
    },
  },
  {
    ...base,
    id: "ce-work/rounds-fold-falls-back-on-pushed-commit",
    skill: "ce-work",
    fixture: PLAIN,
    why: "A commit already on a remote must never be rewritten; the fix lands as an ordinary commit and the report says why.",
    pre_contract: "There is no history rewriting.",
    task: `Use ce-work with rounds:2 fixups:on docs/plans/example-plan.md. The loop has ended clean with two fixes in the working tree. You ran scripts/review-fixups.py fold and it printed {"status":"fallback","reason":"pushed-commits"}. Read references/review-rounds.md and decide what happens next. Do not run anything. Include exactly one line \`HISTORY_REWRITTEN: <yes|no>\` and exactly one line \`FIX_COMMIT: <fold|ordinary>\`.`,
    grade: { declared: { HISTORY_REWRITTEN: "no", FIX_COMMIT: "ordinary" }, files_read_post: ["references/review-rounds.md"], actions: "none", delegates: "none" },
  },
  {
    ...base,
    id: "ce-code-review/depth-focused-lifts-lite",
    skill: "ce-code-review",
    fixture: PLAIN,
    why: "A caller that loops a review over a small fix needs the independent peer read; depth:focused must lift a lite result to focused.",
    pre_contract: "A caller can force only depth:full; a small loud-and-local diff always takes lite and never starts the peer.",
    task: `Use ce-code-review with the arguments: mode:agent depth:focused base:origin/main. Read references/modes-and-output.md. Stage 1 facts: no floor is set, the diff is 6 changed executable lines in one file, and a wrong version would fail loudly where it is made. Resolve the Review depth and stop. Include exactly one line \`DEPTH: <lite|focused|full>\`.`,
    grade: { declared: { DEPTH: "focused" }, actions: "none", delegates: "none" },
  },
  {
    ...base,
    id: "ce-code-review/depth-default-stays-lite",
    skill: "ce-code-review",
    fixture: PLAIN,
    why: "Without depth:focused the same small diff still takes lite: the default is unchanged.",
    pre_contract: "A small loud-and-local diff takes lite.",
    task: `Use ce-code-review with the arguments: mode:agent base:origin/main. Read references/modes-and-output.md. Stage 1 facts: no floor is set, the diff is 6 changed executable lines in one file, and a wrong version would fail loudly where it is made. Resolve the Review depth and stop. Include exactly one line \`DEPTH: <lite|focused|full>\`.`,
    grade: { declared: { DEPTH: "lite" }, actions: "none", delegates: "none" },
  },
  {
    ...base,
    id: "ce-code-review/depth-focused-with-full-keeps-the-roster",
    skill: "ce-code-review",
    fixture: PLAIN,
    why: "A loop that passes depth:full where the shipping review would still needs the peer read; the two tokens are compatible and the adversarial lens is added, not dropped.",
    pre_contract: "Only depth:full and depth:auto exist; depth:full selects adversarial only when the risk rules do.",
    task: `Use ce-code-review with the arguments: mode:agent depth:focused depth:full base:origin/main. Read references/modes-and-output.md. The change is documentation-only prose with no auth, payment, or data-mutation behavior, so the risk rules alone would not select the adversarial lens. Resolve the Review depth and whether the adversarial lens runs, then stop. Include exactly one line \`DEPTH: <lite|focused|full>\` and exactly one line \`ADVERSARIAL: <yes|no>\`.`,
    grade: { declared: { DEPTH: "full", ADVERSARIAL: "yes" }, actions: "none", delegates: "none" },
  },
]
