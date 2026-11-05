# Review rounds

Read this when `references/modes.md` resolved a round count of 1 or more for this run. A run with no round count never opens this file and behaves as it always has.

A round is a complete review of the whole document through Phases 2-5, followed by the loop's own triage and in-place edits. Repeat until the loop stops, then report. The loop only repeats the review you already run; it adds no route, no reviewer, and no data sent anywhere a single review would not send it.

## What the loop may do

- Run each round exactly as a single review runs, including the cross-model pass, its disclosure, `CROSS_MODEL_PEERS`, and `cross_model_review_mode`. A round that skips the peer says why in its Coverage, and the loop continues with that round's in-process reviewers; the next round tries the peer again.
- Treat the `rounds:N` argument or the `doc_review_rounds` default as authority to edit the document in place for findings you judge real, within the edit authority and reviewer requirements `references/synthesis-and-presentation.md` states. It does not authorize reversing a user-settled decision or choosing a product outcome; those stay unresolved for the user.
- Commit nothing. Edits stay in the document in its native format. Where non-interactive mode records open items in the document (`references/open-questions-defer.md`), do it once after the last round, so a later round never reviews a record the loop wrote.
- In non-interactive mode run every round inside the one invocation and return one structured result, so `ce-plan` and `ce-brainstorm` need no change. In interactive mode run the rounds without the routing question and walk-through, then present the report and any unresolved blocking finding as the decision for the user.

## Blocking and minor

This skill's severity scale is `P0` to `P3`. **Blocking** means `P0` or `P1`. **Minor** means `P2` or `P3`. The triage rule below governs your own fixes. Synthesis still applies `safe_auto` corrections as it always does, at any severity.

## Triage

<!-- review-rounds-triage:start -->
Triage each blocking finding yourself before changing anything, against the evidence, the source it cites, and the settled decisions:

- **Fix** it when it is real and reachable in realistic use.
- **Dispute** it, with a reason, when it is theoretical, unreproducible, already true before this work, or an esoteric race or edge case with no concrete trigger.
- **Defer** it, naming the missing evidence or the choice only the user can make, when you cannot decide. A deferred blocking finding is unresolved and goes in the final report.
- Never fix a minor finding. Record it.

Record one line per finding: its title and location (the section, or `file:line` for code), `fixed`, `disputed`, `deferred`, or `minor`, and the reason.
<!-- review-rounds-triage:end -->

## Carrying decisions into the next round

Render this loop's own dispositions as the decision primer `references/decision-primer.md` defines, and read `references/later-round-synthesis.md` at synthesis, where R29 suppresses a re-raised rejected finding: a fixed finding is an applied entry, and a disputed, deferred, or recorded-minor finding is a rejected entry carrying your reason. The peer pass receives no primer by design; R29 drops what it re-raises.

## When to stop

Stop after the first round that meets one of these, in this order:

1. **Clean:** synthesis found no blocking finding, and R29 suppressed none.
2. **Converged:** the round fixed nothing, because each blocking finding was disputed, deferred, or judged speculative (a review of unchanged input only repeats itself); or a finding you disputed earlier came back, suppressed by R29 because its evidence is unchanged.
3. **Exhausted:** the round count was reached. Triage and fix that last round's blocking findings as usual. When a round that ends the loop made fixes, those fixes were not re-reviewed, and the report says so.

After any round that edited the document, the next round reviews the whole edited document.

## Report

End with a short report in plain prose: rounds run, why the loop ended (clean, converged, or exhausted), counts of fixed, disputed, and deferred blocking findings and of recorded minor findings, whether each round's cross-model pass ran, and every unresolved blocking finding with the decision the user must make. In non-interactive mode add it to the structured result as a `Review rounds:` section before `Coverage`.
