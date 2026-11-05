# Mode detection and the interactive question tool

## Interactive mode rules

- **Pre-load the host's blocking question tool already in the current tool list before you ask any question.** If the matching tool is listed but unloaded, use the host's tool-discovery primitive once at the start of the Interactive flow to load that capability — do not search for another host's tool name. Presence in the current tool list is proof; never call a user-facing question tool to discover whether it exists. The routing question, the per-finding walk-through, and the bulk-preview Proceed/Cancel question all depend on it.
- **The numbered-list fallback applies only when the harness genuinely lacks a blocking question tool** — no matching tool is in the current list, a real question call errors, or the runtime mode does not expose one. In those cases, present the options as a numbered list on the host's user-visible chat surface and wait for the reply. A question that calls for a user decision must either call the tool or fall back loudly. Rendering it as narrative text because the tool feels inconvenient, because the model is in report-formatting mode, or because the instruction was buried in a long skill is a bug.
- When a question is a yes/no or a batch confirm, word it so that agreeing accepts the recommendation. Numbered choices stay numbered choices.

## Phase 0: Detect Mode

Arguments may contain a document path, a mode token, or both; both tokens together is not a conflict. Tokens starting with `mode:` are flags, not paths — strip them, and use any remaining token as the document path for Phase 1 (getting the document). `depth:full` is also a flag: strip it and pass it to `references/depth.md`. `rounds:N` is a flag too (see Review rounds below).

`mode:non-interactive` (or its deprecated alias `mode:headless`) sets **non-interactive mode**. This mode changes how the findings that were not applied are delivered; it does not change how findings are classified. Use the same judgment about which tier each finding belongs in:

- fixes that synthesis classifies as Apply are applied and reported in the change list (same as interactive)
- everything else — the grouped confirmation, decisions, and FYI observations — is returned as structured text with the original classifications intact, for the caller to handle. No blocking-question prompts, no interactive routing.
- proposed fixes and decisions that were not applied are also recorded in the document, per `references/open-questions-defer.md`, so they outlive this session, unless the request restricts edits to the document
- Phase 5 (routing) returns immediately with "Review complete" (no routing question, no terminal question)

**Non-interactive argument contract:** `mode:non-interactive <document-path>`, for example `mode:non-interactive <path-to-doc>.{md,html}`. `mode:headless` is a deprecated alias for the same contract.

Absent either mode token, run interactive, with the routing question, walk-through, and bulk-preview behaviors documented in `references/walkthrough.md` and `references/bulk-preview.md`.

## Review rounds

`rounds:N` is also a flag: strip it. Resolve the round count for this run from the first of these that is an integer 0 to 5 (0 means no loop): the `rounds:N` argument (0 turns the loop off for this run), then `doc_review_rounds` from the CE config, then none. A value outside 0 to 5 is invalid; ignore it, say so in one line, and continue to the next source. Read the key as follows:

<!-- ce-config-layers:start -->
**Resolve ordinary CE yaml keys from the two repo files.**

- **Read** `<repo-root>/.compound-engineering/config.local.yaml`, then `config.yaml` (`<repo-root>` = `git rev-parse --show-toplevel`). Missing files are skipped. Gitignore does not change resolution.
- **Win** with the first active (non-commented) value. For scalars, empty is unset; an invalid value continues to the next layer, then the skill default. For lists and maps, a present key — including an empty list or map — replaces the whole key.
- **Do not** use this rule for `docs_root` — that key is `config.yaml` only.
<!-- ce-config-layers:end -->

When the resolved count is 1 or more, read `references/review-rounds.md` before Phase 2. With none, or 0, no round loop runs.
