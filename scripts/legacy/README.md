# Frozen legacy source

`index.html` and `script.js` are copied verbatim from
`github.com/learncomputeracademy/time` at commit **b46bb24** (HEAD of `main`
at the time of the Phase 1 audit, 2026-09-10).

They are committed so that `scripts/extract-legacy.ts` has a **frozen,
reviewable input** — the migration must be reproducible and diffable, not a
one-shot parse of whatever the upstream repo happens to contain today (§36).

Do not edit these files. They are an archive, not source.

`script.js` is kept alongside `index.html` because it holds the only
authoritative decoding of the four ambiguous 12-hour column headers:

    10:30–12:30   12:30–02:30   04:00–06:00   06:00–08:00
        ↓             ↓             ↓             ↓
    10:30–12:30   12:30–14:30   16:00–18:00   18:00–20:00
