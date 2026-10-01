# AGENTS

## Scope and dependencies

This repository contains only the public product source, configuration templates and
tools. Do not import the old private repository's Git history, internal material, real
configuration or enterprise implementation.

`apps` owns startup and assembly; `packages` owns the actual implementation. The
workbench server, the browser interface, the data engine and the Ontology Manager are
maintained per their own runtime boundaries. Public modules must not depend on private
enterprise modules. The wire contracts shared by Node and the browser belong to
contracts, and browser code must not import server implementations.

Ontology Manager components receive the API, the current authentication and preferences
from the host; business permissions are decided by the server. Data browsing and visual
modeling belong to the Manager, and the main workbench keeps no second implementation of
them.

## Changes and verification

Check the actual modules and the existing build entry points first, then run the
applicable checks; do not invent commands or acceptance results
that have not landed. Keep the existing business, permission and data semantics, and
confirm the design before any new business change.

Java tests that touch databases, models or external systems must not be run unfiltered as
a whole. Real configuration and runtime data must not be committed. Save only this task's
results and protect other tasks' changes.

## Collaboration and working directories

Use an ordinary outer directory for an isolated pair of checkouts; do not add a third
repository, lock file or build configuration there. Internal development uses `develop`, and each repository
branches, commits and merges on its own; a branch of the same name is not bound
automatically. Normal work starts from each repository's own `develop` as
`feature/<topic>` or `fix/<topic>` and merges back into `develop` when done. The main
directory checks out `develop` + `develop` by default, and `main` is kept. Builds do not
implicitly fetch, pull or switch branches. Do not introduce a workspace manager.

Use the `worktrees/<topic>/{ontomato,enterprise}` Git worktrees, parallel to the two
repositories, only when the complete combination needs isolation, and keep the
`../ontomato` relative reference unchanged; for independent work on this repository alone
one worktree is enough, and the untouched side checks out an explicit mainline commit. Do
not create a permanent upstream copy, a submodule or a source SHA lock.

Before handing the main directory over for integration, each repository saves its commits
and pauses editing, confirms there is nothing left to save and the relevant services are
stopped, and releases any branch held by a feature worktree; then the main directory
checks out the required combination. Do not let two places write the same branch, and do
not automatically discard, stash or reset other people's work. Once the complete
combination passes, merge each repository back into its own mainline and verify the
mainline combination.

Clarify interface or boundary changes before implementing them, and the main controller
makes the final judgement on the combined result; acceptance by the main controller is the
confirmed approach for this migration and does not mean every later task must be accepted
this way.

## Public history and branches

`main` is this repository's public line: it carries only clean public snapshot history. The
internal remote's `main` and GitHub's `main` hold the same content, and one push to `main`
updates both. The internal development line, `develop`, keeps the original development
history and is never pushed to GitHub. A release publishes to `main` by creating a new
commit whose tree is the reviewed file tree: do not merge `develop` into `main`, and do not
publish the internal history branches or the old tags.

The public GitHub repository has `main` only, so public contributors start from `main`;
`develop` is an internal line that does not exist there. An accepted pull request is not
merged on GitHub: its own commits (those after the snapshot it started from) are
cherry-picked onto `develop`, keeping their authors, because `main` and `develop` share no
history and a plain merge would bring the snapshot commits along. The next snapshot
carries a `Co-authored-by:` trailer for each contributor, and the pull request is closed
with a link to it. Commit subjects on `main` are
English and follow the `type: description` format; commits on the internal `develop` line
follow the outer workspace convention.
