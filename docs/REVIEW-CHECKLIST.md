# Prank Chest — Agent Review Checklist

This is a version-agnostic template for generating a review prompt for an Arch/PM agent.
For each release, fill in the release-specific sections and feed the result to the agent.

---

## How to use this

1. Copy the **Prompt Template** section below
2. Fill in: version, branch, spec file, and the **Decisions table** for this release
3. Feed the completed prompt to a review agent (Claude Opus recommended)
4. Agent returns a structured review — address blockers before merging to main

---

## Prompt Template

```
You are a senior Minecraft Bedrock addon architect reviewing a [VERSION] implementation
PR before it merges to main.

**Repo:** kvadrage/minecraft-prank-chest
**Branch:** [BRANCH]
**Spec:** docs/[SPEC-FILE] (the requirements)
**Release notes:** docs/[RN-FILE] (the implementation summary)

Read both files first, then read src/behavior_pack/scripts/main.js in full,
all manifest.json files, and QUESTIONS.md.

---

### Decisions made this release — assess each one

[PASTE DECISIONS TABLE HERE — see format below]

---

### Always check

#### MUST compliance
- [ ] Every MUST in the spec is implemented exactly as stated
- [ ] No beta APIs used — only @minecraft/server stable (current: 1.16.0)
- [ ] Recipe does not conflict with any vanilla recipe

#### Script logic
- [ ] Timer start/reset: slot change detection is correct (prev vs current typeId)
- [ ] Timer restore after world reload: startTick reconstruction from `rem` is correct
- [ ] `pendingBreak` set prevents double-processing on rapid break events
- [ ] `registryLoaded` guard prevents poll loop running before worldInitialize fires
- [ ] `parseKey()` correctly handles negative coordinates and dimension IDs with colons
- [ ] `flushTimers()` vs `saveRegistry()` split: no cases where dirty state is lost
- [ ] Chunk-unloaded case (getBlock returns undefined): skipped, not unregistered
- [ ] Stale-entry cleanup: only removes entries where block is loaded AND not a chest

#### Registry
- [ ] Keys are built with `dimension.id` (runtime value) consistently — both write and read
- [ ] Registry is saved after every mutation (register, unregister, timer flush)
- [ ] Registry size warning threshold is appropriate
- [ ] No case where a chest can be registered twice under different keys

#### Break handler
- [ ] Vanilla chest item is NOT dropped (cancel fires before vanilla drop)
- [ ] All 27 inventory slots are iterated for drops
- [ ] `prankchest:prank_chest` item is always dropped (even if chest was empty)
- [ ] Block is set to air after drops — chest doesn't remain as a ghost
- [ ] Registry is cleaned up even if setPermutation(air) throws

#### Placement handler
- [ ] Only places into air (never overwrites an existing block)
- [ ] Item is consumed in survival/adventure, not in creative
- [ ] Chunk-unloaded case handled (getBlock returns undefined)
- [ ] Entity refs captured before system.run (block/player refs can go stale)

#### Explosion handler
- [ ] Registry mutation deferred via system.run (not done synchronously in before-event)
- [ ] try/catch wraps getImpactedBlocks() — API may not exist in stable 1.16.0

#### QUESTIONS.md
- [ ] All open questions assessed: real risk / low risk / can be answered from docs
- [ ] Any questions with known answers provided
- [ ] Any new risks identified that weren't in QUESTIONS.md

---

### Output format

Return a structured review with these sections:

**MUST Compliance** — pass / fail per requirement  
**Logic Issues** — bugs or edge cases found (with file + line reference)  
**QUESTIONS.md Assessment** — per-question verdict (confirmed / low risk / needs test)  
**Prioritised Issues** — Blocking / Should-fix / Minor  
**Overall verdict** — Ready to merge / Merge after fixes / Needs rework
```

---

## Decisions table format

Use this format for the release-specific decisions table in the prompt:

```
| Decision | Chosen approach | Rationale |
|---|---|---|
| [What was decided] | [What was chosen] | [Why — including alternatives considered] |
```

Include a row for every non-obvious choice: storage approach, event hook selection,
any Option A/B/C tradeoff, API calls that have multiple valid forms, etc.

---

## Release history

| Version | Spec | Release Notes | Key architectural decision |
|---------|------|---------------|---------------------------|
| v0.1.0  | —    | —             | Entity-based chest (initial) |
| v0.1.1  | [v0.1.1-SPEC.md](v0.1.1-SPEC.md) | [v0.1.1-RN.md](v0.1.1-RN.md) | Bug fixes, visual parity |
| v0.2.0  | [v0.2-SPEC.md](v0.2-SPEC.md) | [v0.2.0-RN.md](v0.2.0-RN.md) | Vanilla chest rewrite |
