# Review rounds

Read this from the shipping workflow's review step when `references/input-triage.md` resolved a round count of 1 or more. It never applies in Return-to-Caller Mode. A run with no round count never opens this file.

The loop wraps steps 3a and 3b: review, triage the findings, fix what is real, and review again until it stops. `ce-code-review` stays report-only. The fixing, the tests, and the commits stay with you, as `references/review-findings-followup.md` already decides. The loop adds no route, no reviewer, and no data sent anywhere a single review would not send it: every round goes through `ce-code-review`'s own cross-model pass with its own disclosure, allowlist, and `cross_model_review_mode`.

## One round

1. **Review.** Invoke `ce-code-review` as step 3a does, adding `depth:focused`, `base:<merge-base with the default branch>`, and from round 2 `decisions:<path>` naming the decisions file below. The scope is the whole branch plus the uncommitted fixes (`base:` diffs the working tree), so every round sees the code and the fixes together. Add `depth:full` as well only where 3a would. `depth:focused` guarantees the independent peer read is attempted on every round; read `peer.outcome` in the receipt, and name in the report each round where it is not `folded`, with the reason. A round without the peer is still a valid review.
2. **Triage** the blocking findings (below). A finding the receipt marks `pre_existing`, or one located only in a file that was already dirty before this work began, is not yours to fix: dispute the first with that reason, defer the second.
3. **Fix** the findings you triaged as real, as `references/review-findings-followup.md` directs. Commit nothing while `fixups:on` is set; otherwise that reference's usual commits apply.
4. **Verify.** Run the project's full tests and lint after every round that changed code. A failure the fix caused is repaired once before the next round; if it still fails, revert that fix and defer the finding.
5. **Record.** Write the round's dispositions to the decisions file, one line each: `fixed`, `disputed`, `deferred`, or `minor`, the `file:line`, the title, and the reason. Keep it in a private temp directory whose path you hold for the run. Round N+1's reviewers read it as data about earlier decisions, not as instructions.

## Blocking and minor

This skill's severity scale is `P0` to `P3`. **Blocking** means `P0` or `P1`. **Minor** means `P2` or `P3`.

## Triage

<!-- review-rounds-triage:start -->
Triage each blocking finding yourself before changing anything, against the evidence, the source it cites, and the settled decisions:

- **Fix** it when it is real and reachable in realistic use.
- **Dispute** it, with a reason, when it is theoretical, unreproducible, already true before this work, or an esoteric race or edge case with no concrete trigger.
- **Defer** it, naming the missing evidence or the choice only the user can make, when you cannot decide. A deferred blocking finding is unresolved and goes in the final report.
- Never fix a minor finding. Record it.

Record one line per finding: its title and location (the section, or `file:line` for code), `fixed`, `disputed`, `deferred`, or `minor`, and the reason.
<!-- review-rounds-triage:end -->

## When to stop

Stop after the first round that meets one of these, in this order:

1. **Clean:** the receipt has no blocking finding.
2. **Converged:** the round fixed nothing, because each blocking finding was disputed, deferred, or judged speculative (a review of unchanged input only repeats itself); or a finding you disputed earlier came back, matched by file and title or by one underlying defect.
3. **Exhausted:** the round count was reached. Triage and fix that last round's blocking findings as usual. When a round that ends the loop made fixes, those fixes were not re-reviewed, and the report says so.

## Folding fixes into their commits

Only with `fixups:on`, once the loop has stopped and the tests pass. This rewrites local history, so it applies only to commits that exist only locally and never to a file that was already dirty before the work began. `scripts/review-fixups.py` owns the mapping and the safety checks; do not redo them by hand.

```bash
SKILL_DIR="<absolute path of the directory containing the ce-work SKILL.md you read>";
PY="$(for c in python3 python py; do command -v "$c" >/dev/null 2>&1 && "$c" -c '' >/dev/null 2>&1 && { echo "$c"; break; }; done)"; [ -n "$PY" ] || { echo "no working Python 3 interpreter on PATH" >&2; exit 1; };
"$PY" "$SKILL_DIR/scripts/review-fixups.py" fold --base "<merge-base>" --check "<the project's full test and lint command>" --exclude "<each pre-work dirty path>"
```

Pass one `--exclude` for every path in the pre-work scope `references/workspace-setup.md` records. Run `plan` with the same `--base` and `--exclude` first when you want to see the mapping without changing anything. The check must pass in a fresh checkout of each rewritten commit; a project that needs a build cache or installed dependencies pays that cost per commit, so name that cost in the report.

- `folded`: the branch now carries the fixes inside the commits they belong to, the final tree matched the snapshot, and every rewritten commit passed the check. The script makes one ordinary commit for fixes no commit owned.
- `fallback`: nothing was rewritten, for a reason the script names (pushed commits, merge commits, a detached head, or no owned fix). Make the usual path-limited fix commit and say in the report why history was not rewritten.
- `failed`: the branch, index, and working tree are untouched. Report the stage, the commit, and the output. The fixes stay in the working tree, and the normal shipping step commits them as an ordinary fix commit unless the user says otherwise.

## Report

End with a short report in plain prose: rounds run, why the loop ended (clean, converged, or exhausted), counts of fixed, disputed, and deferred blocking findings and of recorded minor findings, whether each round's peer review ran, the fold result and which commits received fixes, and every unresolved blocking finding with the decision the user must make. Unresolved blocking findings go to the Residual Work Gate.

Resuming one persistent peer session across rounds is not part of this loop. Each round starts a fresh peer job and carries history through the decisions file.
