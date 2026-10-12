# Shoot Studio: agent instructions

Shoot Studio is a Tauri photo culling and editing app: Rust in `src-tauri/src`,
plain JavaScript in `ui/` with no bundler. This repository is public, so keep
personal details, real photos and local paths out of code, docs and commits.

## Shared notes

Chats may share a git-ignored `PROJECT_NOTES.md`. Never edit it directly:
post each note as a fenced `project-note` block in your reply, under 4,000
characters. When a round is committed and checked, close its notes with one
`SUMMARY` note whose last line is `Close:` and the ids it makes obsolete, and
carry anything still open into a single `BACKLOG` note. Never close a note
whose open items aren't carried in the backlog, a doc or git.

## Checks

- `node ui-check.cjs` (headless Chromium, mocked Tauri commands).
- `cargo test` and `cargo clippy --all-targets` in `src-tauri/`.
- Commit only when the owner asks; the owner pushes and tags.
