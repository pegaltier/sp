# AGENTS

## Purpose

`server/lib/git/` owns the Git backend abstraction used by source-checkout update flows and Git-backed module installs.

It provides a stable interface over multiple backend implementations so the rest of the server and CLI can talk to Git without coupling themselves to one transport.

Documentation is top priority for this subtree. After any change under `server/lib/git/`, update this file and any affected parent or dependent docs in the same session.

## Ownership

Current files:

- `client_interface.js`: shared Git client assertions and interface shape
- `client_create.js`: backend selection and client creation
- `native_handler.js`: native Git backend
- `nodegit_handler.js`: NodeGit backend
- `isomorphic_handler.js`: isomorphic-git backend
- `local_history.js`: per-directory local-history client selection for app-layer owner repositories
- `shared.js`: shared backend-selection, remote-sanitization, and history path-filter helpers

## Backend Selection Contract

Current backend order:

- `native`
- `nodegit`
- `isomorphic`

Current rules:

- `createGitClient({ projectRoot })` resolves the best available client for local repo operations
- `cloneGitRepository(...)` resolves the best available clone client for remote installs
- `createLocalGitHistoryClient({ repoRoot })` resolves the best available local-history client for per-owner `L1/<group>/` and `L2/<user>/` repositories
- `SPACE_GIT_BACKEND` may force a specific backend name
- update and install backend clients must satisfy the shared interface asserted by `client_interface.js`
- local-history clients expose `ensureRepository`, `commitAll`, `listCommits`, `getCommitDiff`, `previewOperation`, `rollbackToCommit`, and `revertCommit`
- native local-history clients must run Git subprocesses asynchronously and serialize operations per `repoRoot` through one shared queue so debounced owner-root history work does not block the server event loop or race the same repository from multiple callers
- local-history `commitAll`, `listCommits`, `getCommitDiff`, and `previewOperation` accept ignored repository-relative paths so backend implementations can untrack and hide runtime-sensitive files consistently
- local-history `listCommits` accepts `limit`, `offset`, and optional `fileFilter`, treats plain filters as open-ended contains matches across changed paths and nested filenames, returns commit metadata plus full per-file action entries for listed commits, and should avoid loading full patch bodies for list pages
- `previewOperation` accepts travel or revert operations and returns affected-file metadata plus an operation-specific patch when a `filePath` is provided
- local-history rollback should preserve the pre-reset head in backend-owned history refs when possible so commits after the reset remain listable for forward travel
- `revertCommit` creates a new commit with inverse changes and does not move the current branch back to the selected commit
- local-history repositories are local-only infrastructure repositories with no remote requirement

## Development Guidance

- keep backend-specific behavior behind this abstraction
- do not import a backend implementation directly from unrelated server or command code when `client_create.js` already owns selection
- use `local_history.js` rather than shelling out directly when writable app-layer history needs Git operations
- keep remote sanitization and backend-resolution logic centralized in `shared.js`
- preserve the shared per-repo serialization rule for local-history backends whenever native-history process handling changes
- if backend order, interface shape, or environment-variable behavior changes, update this file and the relevant server or command docs in the same session
