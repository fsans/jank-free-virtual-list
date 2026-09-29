# AGENTS.md

Instructions for coding agents working in this repository.

## What this repo is

A single [agent skill](jank-free-virtual-list/SKILL.md): `jank-free-virtual-list`, a strategy for scroll-stable virtualized rendering of huge chat/feed/timeline UIs (skeleton map + island loading + anchor-row scroll compensation).

There is no build system, test suite, or package manifest. Changes are markdown-only; verification is the checklist at the bottom of this file.

## Layout rules

```
jank-free-virtual-list/          # repo root
├── README.md                    # human-facing overview (repo root only)
├── AGENTS.md                    # this file (repo root only)
└── jank-free-virtual-list/      # the skill — the ONLY directory agents load at runtime
    ├── SKILL.md                 # required entry point: YAML frontmatter + instructions
    └── references/              # material loaded on demand
```

- The skill folder name must always equal the `name` field in SKILL.md frontmatter. If you rename one, rename both.
- Skill content lives only inside `jank-free-virtual-list/`. Never add README, CHANGELOG, INSTALL, or other auxiliary docs inside the skill folder — the skill should contain only what an agent needs to do the job. Repo-level docs belong at the root.
- New bundled resources go in `scripts/` (deterministic/repeated code), `references/` (context loaded as needed), or `assets/` (files used in output) inside the skill folder.

## SKILL.md conventions

- Frontmatter contains exactly two fields: `name` and `description`. Nothing else.
- `description` is the only trigger mechanism. It must state what the skill does AND when to use it, including concrete user phrasings that should activate it. Never move "when to use" guidance into the body — the body is only read after triggering.
- Write body instructions in imperative/infinitive form ("Fetch the outline", not "You should fetch").
- Keep SKILL.md under ~500 lines. It shares a context window with everything else the agent is doing; only include what a smart model wouldn't already know.
- Progressive disclosure: keep core workflow in SKILL.md; move detailed material (pseudocode, schemas, pitfalls, library notes, examples) into `references/` and link to it from SKILL.md with a clear statement of when to read it.
- Reference files load one level deep from SKILL.md (no nested reference chains). Give any reference file longer than 100 lines a table of contents at the top.
- Don't duplicate information between SKILL.md and reference files — each fact lives in one place.

## Editing the skill content

- The strategy's three pieces (skeleton map, island loading, anchor-row compensation) and the deterministic anchor rules are the core of the skill. Preserve their semantics when refactoring wording.
- Pseudocode in `references/implementation-notes.md` is illustrative TypeScript-ish; keep it language-neutral and consistent with the anchor rules in SKILL.md.
- When adding guidance, prefer concrete triggers, numbers, and failure modes over general advice.

## Validation checklist (run before committing)

1. SKILL.md frontmatter is valid YAML with exactly `name` and `description`; `name` matches the skill folder name.
2. Every file referenced from SKILL.md exists at the stated relative path (currently `references/implementation-notes.md`), and no reference file is orphaned.
3. Markdown links resolve; reference files >100 lines start with a TOC.
4. No auxiliary documentation files were added inside the skill folder.
5. Skill folder still works standalone: copying `jank-free-virtual-list/` alone into a skills directory must be sufficient.

## Git

- Small, focused commits with imperative messages (e.g. "Add streaming pitfalls to implementation notes").
- No CI exists; do not add workflows or dependencies without being asked.
