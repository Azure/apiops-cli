# Work Routing

How to decide who handles what.

## Routing Table

Machine-readable data: [`.squad/routing-table.json`](routing-table.json)

Each entry has `workType`, `routeTo` (squad member name), and `examples` (keyword list for matching).

## Issue Routing

Machine-readable data: [`.squad/issue-routing.json`](issue-routing.json)

Each entry has `label`, `action`, and `who` (squad member name).

### How Issue Assignment Works

1. A maintainer reviews the issue and applies a `go:*` decision label.
2. When a maintainer applies `go:yes`, the issue assignment workflow assigns the issue to that maintainer.
3. The assignment workflow reads the issue text, optionally uses the most recent `Squad Triage` comment from the last 50 issue comments, and applies `squad` plus matching `squad:{member}` labels from [`.squad/routing-table.json`](routing-table.json) and [`.squad/issue-routing.json`](issue-routing.json).
4. The `squad` label marks the issue for squad routing, and each `squad:{member}` label identifies a matched follow-up area.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
