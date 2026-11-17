## Project knowledge

This repository contains a **Grafana plugin**. You must Read @./.config/AGENTS/instructions.md before doing changes.

## Resuming development (spec-driven work)

Work follows a spec and a feature queue kept in this repo, so any session can pick up where the last one stopped:

1. `git checkout master && git pull`, then read `docs/dev/CONTEXT.md` (full context snapshot) and `docs/dev/PROGRESS.md` (current item, last step, next step, env notes). PROGRESS is updated on the feature branch before its PR merges, so check the last PR it names with `gh pr list --state open`: an open PR means finish its gates, merge it, then continue.
2. If PROGRESS names an in-progress branch, check it out and continue from "Next step"; otherwise take the next `todo` row in `docs/dev/PLAN.md`.
3. Feature specs live in `docs/spec/` (grep the spec ID). Tests and the integration matrix: `docs/dev/TESTING.md`. Past decisions: `docs/dev/DECISIONS.md`.
4. Refresh `docs/dev/CONTEXT.md` and push after every feature, every review-fix round, every important step inside a feature (core logic done, tests green), and periodically during long features — a session can end at any moment. Update `docs/dev/PROGRESS.md` and push at every step boundary (tests written, implementation passing, gates green, merged). On a "stop" request: write PROGRESS, commit `wip: …` to the feature branch, push, end.
