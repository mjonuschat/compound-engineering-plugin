#!/usr/bin/env python3
"""Fold uncommitted review-loop fixes into the local commits they belong to.

Two subcommands, both print one JSON object on stdout.

  plan  --base REF [--exclude PATH]...
        Map each changed file to the commit in merge-base..HEAD that introduced
        the code the fix touches, and report whether that range may be rewritten.
        Writes nothing.

  fold  --base REF --check CMD [--exclude PATH]... [--message MSG]
        Rewrite the range in a throwaway worktree: one `git commit --fixup` per
        owned file, one ordinary commit for fixes no commit owns, then
        `rebase -i --autosquash`. The branch moves only after the final tree
        equals the working-tree snapshot and CMD passes at every rewritten
        commit. Any failure leaves the branch, index, and working tree as they
        were.

Exit status: 0 for `folded`, `fallback`, and `plan`; 1 for `failed`; 2 for usage.
`fallback` means the caller should make a normal path-limited fix commit.
"""
import argparse
import collections
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@")


class Fail(Exception):
    def __init__(self, stage, detail, commit=None):
        super().__init__(detail)
        self.stage = stage
        self.detail = detail
        self.commit = commit


def run(args, cwd=None, env=None, stdin=None, check=True, timeout=None):
    e = dict(os.environ)
    e["GIT_LITERAL_PATHSPECS"] = "1"
    e["GIT_TERMINAL_PROMPT"] = "0"
    if env:
        e.update(env)
    p = subprocess.run(
        args, cwd=cwd, env=e, input=stdin, capture_output=True, text=True, timeout=timeout
    )
    if check and p.returncode != 0:
        raise Fail("git", f"{' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p


def git(*args, cwd=None, env=None, stdin=None, check=True):
    return run(["git", *args], cwd=cwd, env=env, stdin=stdin, check=check).stdout


def pathspec_stdin(paths):
    return "".join(p + "\0" for p in paths)


def changed_paths(root, exclude):
    """Changed tracked and untracked paths relative to HEAD, minus exclusions."""
    out = git("status", "--porcelain=v1", "-z", "--untracked-files=all", cwd=root)
    tokens = out.split("\0")
    paths, i = [], 0
    while i < len(tokens):
        t = tokens[i]
        i += 1
        if len(t) < 4:
            continue
        status, path = t[:2], t[3:]
        paths.append(path)
        if "R" in status or "C" in status:  # next token is the original path
            paths.append(tokens[i])
            i += 1
    ex = set(exclude)
    return sorted({p for p in paths if p and p not in ex})


def tracked_at_head(root, path):
    return run(["git", "cat-file", "-e", f"HEAD:{path}"], cwd=root, check=False).returncode == 0


def blame_shas(root, path, start, count):
    out = git("blame", "--porcelain", "-L", f"{start},{start + count - 1}", "HEAD", "--", path, cwd=root)
    shas = []
    for line in out.splitlines():
        head = line.split(" ", 1)[0]
        if HEX40.match(head):
            shas.append(head)
    return shas


def line_count_at_head(root, path):
    return len(git("show", f"HEAD:{path}", cwd=root).splitlines())


def owner_votes(root, path, in_range):
    """Count blame votes for the pre-image of each changed hunk."""
    diff = git("diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", path, cwd=root)
    total = line_count_at_head(root, path)
    votes = collections.Counter()
    outside = 0
    for line in diff.splitlines():
        m = HUNK.match(line)
        if not m:
            continue
        a = int(m.group(1))
        b = 1 if m.group(2) is None else int(m.group(2))
        if b > 0:
            shas = blame_shas(root, path, a, b)
        else:  # pure insertion after old line `a`: the neighbouring line votes once
            anchor = min(max(a, 1), total) if total else 0
            shas = blame_shas(root, path, anchor, 1) if anchor else []
        for s in shas:
            if s in in_range:
                votes[s] += 1
            else:
                outside += 1
    return votes, outside


def choose_target(root, path, in_range):
    if not tracked_at_head(root, path):
        return None, "new-file"
    votes, outside = owner_votes(root, path, in_range)
    if not votes:
        return None, "base-owned" if outside else "no-owner"
    ranked = votes.most_common()
    top_sha, top = ranked[0]
    if len(ranked) > 1 and ranked[1][1] == top:
        return None, "ambiguous"
    if outside >= top:
        return None, "base-owned"
    return top_sha, "blame"


def build_plan(root, base, exclude):
    blockers = []
    head = git("rev-parse", "HEAD", cwd=root).strip()
    branch = run(["git", "symbolic-ref", "-q", "--short", "HEAD"], cwd=root, check=False).stdout.strip()
    if not branch:
        blockers.append("detached-head")
    mb = git("merge-base", base, "HEAD", cwd=root).strip()
    commits = git("rev-list", "--reverse", f"{mb}..HEAD", cwd=root).split()
    unpushed = set(git("rev-list", f"{mb}..HEAD", "--not", "--remotes", cwd=root).split())
    pushed = [c for c in commits if c not in unpushed]
    if pushed:
        blockers.append("pushed-commits")
    if git("rev-list", "--merges", f"{mb}..HEAD", cwd=root).split():
        blockers.append("merge-commits")
    if not commits:
        blockers.append("no-unit-commits")
    in_range = set(commits)
    entries = []
    for p in changed_paths(root, exclude):
        target, reason = choose_target(root, p, in_range)
        entries.append({"path": p, "target": target, "reason": reason})
    if entries and all(e["target"] is None for e in entries) and "no-unit-commits" not in blockers:
        blockers.append("no-owned-fixes")
    return {
        "branch": branch or None,
        "head": head,
        "merge_base": mb,
        "commits": commits,
        "pushed": pushed,
        "rewritable": not blockers,
        "blockers": blockers,
        "entries": entries,
    }


def snapshot_tree(root, paths):
    """Tree of HEAD with `paths` taken from the working tree (covers untracked files)."""
    tmp = tempfile.mkdtemp(prefix="ce-fixups-index-")
    try:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
        git("read-tree", "HEAD", cwd=root, env=env)
        if paths:
            git("add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul", cwd=root, env=env, stdin=pathspec_stdin(paths))
        return git("write-tree", cwd=root, env=env).strip()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def copy_into(root, wt, paths):
    for p in paths:
        src, dst = os.path.join(root, p), os.path.join(wt, p)
        if os.path.lexists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.lexists(dst):
                os.remove(dst)
            if os.path.islink(src):
                os.symlink(os.readlink(src), dst)
            else:
                shutil.copy2(src, dst)
        elif os.path.lexists(dst):
            os.remove(dst)


def fold(root, base, check, exclude, message):
    plan = build_plan(root, base, exclude)
    if not plan["rewritable"]:
        return {"status": "fallback", "reason": ",".join(plan["blockers"]), "plan": plan}
    entries = plan["entries"]
    paths = [e["path"] for e in entries]
    expected = snapshot_tree(root, paths)
    stash_sha = run(["git", "stash", "create"], cwd=root, check=False).stdout.strip() or None
    old_head, branch, mb = plan["head"], plan["branch"], plan["merge_base"]
    old_trees = [git("rev-parse", f"{c}^{{tree}}", cwd=root).strip() for c in plan["commits"]]

    scratch = tempfile.mkdtemp(prefix="ce-fixups-")
    wt = os.path.join(scratch, "wt")
    added = False
    try:
        git("worktree", "add", "--detach", wt, old_head, cwd=root)
        added = True
        copy_into(root, wt, paths)
        by_target = collections.defaultdict(list)
        orphans = []
        for e in entries:
            (by_target[e["target"]] if e["target"] else orphans).append(e["path"])
        for target, ps in by_target.items():
            git("add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul", cwd=wt, stdin=pathspec_stdin(ps))
            git("commit", "-q", "--no-verify", f"--fixup={target}", "--pathspec-from-file=-", "--pathspec-file-nul",
                cwd=wt, stdin=pathspec_stdin(ps))
        if orphans:
            git("add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul", cwd=wt, stdin=pathspec_stdin(orphans))
            git("commit", "-q", "-m", message, "--pathspec-from-file=-", "--pathspec-file-nul",
                cwd=wt, stdin=pathspec_stdin(orphans))
        env = {"GIT_SEQUENCE_EDITOR": "true", "GIT_EDITOR": "true"}
        p = run(["git", "rebase", "-q", "-i", "--autosquash", mb], cwd=wt, env=env, check=False)
        if p.returncode != 0:
            run(["git", "rebase", "--abort"], cwd=wt, check=False)
            raise Fail("rebase", p.stderr.strip() or p.stdout.strip())
        new_head = git("rev-parse", "HEAD", cwd=wt).strip()
        if git("rev-parse", f"{new_head}^{{tree}}", cwd=wt).strip() != expected:
            raise Fail("tree-identity", "final tree differs from the working-tree snapshot")
        new_commits = git("rev-list", "--reverse", f"{mb}..{new_head}", cwd=wt).split()
        checked = []
        for i, c in enumerate(new_commits):
            tree = git("rev-parse", f"{c}^{{tree}}", cwd=wt).strip()
            if i < len(old_trees) and tree == old_trees[i]:
                continue
            git("checkout", "-q", "--detach", c, cwd=wt)
            try:
                r = subprocess.run(check, shell=True, cwd=wt, capture_output=True, text=True, timeout=3600)
            except subprocess.TimeoutExpired:
                raise Fail("check", "check command timed out", c)
            if r.returncode != 0:
                tail = (r.stdout + r.stderr).strip().splitlines()[-20:]
                raise Fail("check", "\n".join(tail), c)
            checked.append(c)
        if snapshot_tree(root, paths) != expected:
            raise Fail("drift", "the working tree changed while the rewrite ran")
        if git("rev-parse", "HEAD", cwd=root).strip() != old_head:
            raise Fail("drift", "HEAD moved while the rewrite ran")
        git("update-ref", "-m", "review-fixups: fold fixes into their commits", f"refs/heads/{branch}", new_head, old_head, cwd=root)
        git("reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", cwd=root, stdin=pathspec_stdin(paths))
        return {
            "status": "folded",
            "branch": branch,
            "old_head": old_head,
            "new_head": new_head,
            "stash_sha": stash_sha,
            "tree": expected,
            "folded": [e for e in entries if e["target"]],
            "own_commit": orphans,
            "checked_commits": checked,
        }
    finally:
        if added:
            run(["git", "worktree", "remove", "--force", wt], cwd=root, check=False)
            run(["git", "worktree", "prune"], cwd=root, check=False)
        shutil.rmtree(scratch, ignore_errors=True)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "fold"):
        sp = sub.add_parser(name)
        sp.add_argument("--base", required=True)
        sp.add_argument("--exclude", action="append", default=[])
    sub.choices["fold"].add_argument("--check", required=True)
    sub.choices["fold"].add_argument("--message", default="fix(review): apply code review fixes")
    args = ap.parse_args(argv)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    signal.signal(signal.SIGHUP, lambda *_: sys.exit(129))
    try:
        root = git("rev-parse", "--show-toplevel").strip()
        if args.cmd == "plan":
            out = build_plan(root, args.base, args.exclude)
        else:
            out = fold(root, args.base, args.check, args.exclude, args.message)
    except Fail as f:
        out = {"status": "failed", "stage": f.stage, "detail": f.detail, "commit": f.commit}
        print(json.dumps(out))
        return 1
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
