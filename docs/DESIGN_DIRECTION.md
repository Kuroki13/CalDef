# CalDef 2.0 — Design direction

The reference for the visual system that replaces "Scoreboard". Product
requirements stay in `PRODUCT_SPEC.md` (§16.1 records the decision);
`ARCHITECTURE.md` invariant 23 changes when the tokens change in code.

Status: **V3 approved by the account owner (2026-11-19) as the design
foundation; implementation is incremental, on branch `caldef-2` with preview
deployments, each phase reviewed before the next.** Phase 1 (tokens, palette,
type) is done there. The V3 prototype is kept in the repository as
`docs/design/2026-11-17-caldef2/v3-prototype.html` (open it in a browser; it
reads and writes nothing).

Owner's additions at approval: the 11 px labels of V3 are raised — 12 px is
the floor and gym-facing labels go larger; the prototype is a direction, not
a pixel specification; previews before production.

## 0. V3 decisions (supersede anything below that disagrees)

**Live workout states.** Set ready → Saving → Resting → Next set ready, plus
Refused. "Complete set N · weight × reps" exists only in Set ready (and is
locked while Saving); during Resting the one primary action is "Skip rest"
(±15 s beside it) — a set can never be completed before it is performed. A
refused save stops the flow with "Edit and retry" / "Discard". Each set row
says its state in a word and a shape as well as a colour: Saved (filled
disc), Saving (spinner), Waiting to sync (hatched/outlined, amber), Not saved
(warning disc), Now, Planned. Finish appears only once nothing is waiting.
These map onto the existing `save-queue.ts` behaviour (latest value per set,
upsert on position, refusal dropped and reported) — no new subsystem.

**Live workout hierarchy.** Exercise name up to two lines; the session clock
is a small meta line; weight and reps are 56 × 68 steppers whose figure is
also a typed field (comma accepted); "Reuse 80 kg × 6" replaces "Use"; one
primary action at a time; the details button opens the exercise page with
"Back to set N".

**Today.** A Midnight balance card: kcal eaten with "of target" and "left",
the target marked on the bar, meals logged; protein "of target g"; weight
trend in kg with its weekly rate. Meals as full rows with calories in their
own column and "Add this meal" in words (never "Log 640").

**Capsule.** A 52 pt row of the tab bar (never a layer over content): current
exercise and set, or the rest countdown and next set, or "N sets waiting to
sync" with an amber dot; hidden while the keyboard is up; returning restores
the previous tab and scroll position.

**Light mode.** L1 "Open porcelain" is preferred (white top, `default` status
bar). If the on-device test shows the bar does not follow dark mode, L2 is a
Midnight cap no taller than the status bar (50 pt), not a band.

**Accessibility (measured).** Smallest text 11 px; planned-set outline
`#857D94` light (3.9:1) / `#7A7290` dark (4.1:1) — V2's was 1.7:1; all text
pairs ≥ 4.5:1 in both themes (table in the V3 page).

**Found during V3, to fix separately (not visual):** food search folding
keeps "œ", so "oeuf" cannot match a Ciqual "Œuf …" in local ranking; the
remaining retry tokens (Quick Add, recipes, saved meals, AI review). Media
hand review rejected Everkinetic's only barbell row (reverse grip).

**Unverified on a physical iPhone:** the status-bar behaviour (lab test), the
real keyboard with the dock, lock-and-resume on the new screens, motion
smoothness, one-handed reach, video playback; haptics are not promised.

---

## 1. Identity

**Luxury Tech, Midnight Purple.** Precise, quiet, athletic without
aggression. Chronograph contributes precision — large thin tabular figures,
measured bars, one rest arc — but the product must not look like a watch or
stopwatch: no tick-mark rings or minute tracks outside the rest timer.

Luxury comes from composition, not decoration: layered surfaces, a soft
Midnight light in the top band, exact alignment, restrained colour. Purple is
recognisable on every screen because it is *the action colour*, not because
things are painted purple.

## 2. Colour (measured, WCAG 2.x)

| Role | Light | Dark | Rule |
|---|---|---|---|
| Page | `#F6F4F1` porcelain | `#0D0A13` | text 16.6 / 17.2 |
| Surface | `#FFFFFF` | `#17121F` | muted text ≥ 5.2 |
| Surface 2 | `#EFECF2` | `#211A2D` | muted text ≥ 4.8 |
| Text / muted | `#17131F` / `#6B6479` | `#F2EFF7` / `#9088A0` | |
| Action purple | `#5B3A9B` (white on it 8.3) | `#B9A2EE` (ink on it 8.5) | primary action, active tab, focus, done set, "+" |
| Midnight band | `#1F1530` + radial light | `#0D0A13` + radial light | under the status bar (see §6) |
| Lume | `#C9B8F5` (on band 8.7) | `#B9A2EE` | the measured thing, on the band only |
| Success / warning / error | `#1C7A54` / `#9A5A00` / `#B42318` | `#5FD3A0` / `#F0B45A` / `#FF8A80` | states, never decoration |
| Champagne | `#8A6A35` | `#D8B67A` | personal records only, as a small diamond |

Never: purple body text, large fills or gradients, purple shadows, purple for
every chart series. Charts: "you" (trend, your sets) is the one purple series;
readings are neutral dots; projections dotted and labelled; goals dashed.

## 3. Type

Geist only (OFL, already bundled), Geist Mono for labels and units.
Barlow Condensed is removed in step 1 once Geist's tabular figures are
confirmed in the build. Figures: weight 200 at ≥ 40 px, 300 at ≥ 24 px,
always `tabular-nums`. Names and titles in sentence case (long workout names
no longer truncate in capitals). Labels: mono, 9–11 px, tracked uppercase.

## 4. Surfaces, space, geometry

- Level 0 page; level 1 surface (light: white + two-layer shadow tinted toward
  midnight; dark: lighter surface + 6 % white top edge, no shadow); level 2
  sheet (24 px top radius, scrim, handle).
- 4 px base; 16 px gutter + safe areas; radii 28 band edge, 24 sheet, 18
  surface, 13 control, full for pills/set discs.
- Touch targets ≥ 44 px; session steppers 62 px; the Complete button 56 px.

## 5. Navigation and the session capsule

- Four tabs (Today, Nutrition, Training, Progress), solid bar, active tab =
  purple + heavier stroke + top bar mark. A "More" grid replaces the menu.
- The live session is full screen, no tab bar; its only bottom control is
  "Complete set N · weight × reps".
- **Session capsule** (resume from anywhere): a 46 px row that is *part of the
  tab bar*, not a layer over the page. The page's scroll area ends above it,
  so it cannot cover content. Shown on every screen except the session while a
  session is in progress. States: training (current exercise + session
  clock), resting (countdown arc + next set), not yet saved (amber dot, "kept
  on this phone" — the save queue's true state, never shown as saved). It
  reads state only; it never logs a set.

## 6. Status bar and the top band

`black-translucent` (current) draws the status bar in white, so whatever sits
beneath must be dark. Two designs, decided by an on-device test:

- **L1 Open porcelain** — `statusBarStyle: default` with a white top, if iOS
  switches the bar for dark mode (`theme-color` with a dark media query).
- **L2 Midnight veil** — keeps `black-translucent`; the band is only as tall
  as the title, ends in a 28 px curved horizon, carries a faint Midnight
  light; in dark it dissolves into the page.

Test: three temporary static pages (no data) — default + theme-color per
scheme / default alone / black-translucent — installed on the owner's iPhone
and switched light↔dark. Deploying them needs the owner's go-ahead. Either
way `themeColor` becomes per-theme (it is hard-coded `#0f1216` today).

## 7. Screens (v2)

- **Today** — the balance card (eaten, protein, trend) rises over the band;
  below it **the day line**: the day's events in order (weigh-in, meals
  logged, session in progress, planned workout, a meal not logged with its
  usual). Built only from existing data; a missing meal is "not logged",
  never zero. Add food (meal named, changeable) and Weigh in at thumb height.
- **Live set** — exercise card with its licensed drawing (tap → details in a
  sheet, session kept), set discs, kg/reps steppers, last time inline with
  "Use" (copies a plan, never marks done), Complete.
- **Rest** — one smooth arc (no ticks) with a soft leading glow, the next set
  named, ±15 s / Skip, Complete still under the thumb. Time = now − timestamp.
- **Exercise detail** — start/end positions side by side (optionally
  alternating, off under reduced motion), a Video tab where a licensed clip
  exists, the licence credit under the media, records, progression, add.
- **Library** — "Your lifts" as illustrated cards; the 980-entry catalogue
  as a fast list with 46 px drawings or a quiet monogram where none exists.

## 8. Motion

| Moment | Duration | Easing | Reduced motion |
|---|---|---|---|
| Press | 120 ms | scale .97, `cubic-bezier(.2,.8,.2,1)` | colour only |
| Set complete (tick draws, disc fills) | 260 + 220 ms | draw `(.2,.8,.2,1)`, fill `(.34,1.3,.64,1)` | instant, shape still differs |
| Card → rest arc | 300 ms | `(.32,.72,0,1)` | crossfade 120 ms |
| Sheet | 380 / 240 ms | `(.32,.72,0,1)` | fade |
| Capsule → session (shared clock) | 280 ms | View Transitions, progressive | none |
| Changing figures | 200 ms | 6 px slide + fade | none |

The save is queued on tap; animation never delays it. No haptics are
promised (no reliable vibration API in iOS Safari).

## 9. Exercise media (architecture; deployment gated)

Verified 2026-11-17 against primary sources:

| Source | Content | Licence | Use |
|---|---|---|---|
| Everkinetic (`github.com/everkinetic/data`) | 293 exercises, start ("relaxation") / end ("tension") drawings, SVG+PNG | CC BY-SA 4.0 (repository licence) | first |
| wger images (`wger.de/api/v2/exerciseimage`) | 394 images / 287 exercises | per image: CC BY-SA 4.0 (300), 3.0 (88), CC0 (6) | second; exclude the 46 flagged AI-generated and the 104 with no author |
| wger videos (`wger.de/api/v2/video`) | 78 videos / 46 exercises, 1080p, median 30 MB | all CC BY-SA 4.0 | demos, re-encoded once |
| Wikimedia Commons | scattered | per file | gaps only, vetted per file |
| free-exercise-db photos | — | no stated licence or provenance | **excluded** (unchanged) |
| ExerciseDB, MuscleWiki, other apps | — | proprietary | **excluded** |

- Recolouring an SVG or re-encoding a video is an adaptation: it stays CC
  BY-SA, is marked "modified", and is credited under the media and on a
  credits page.
- `scripts/build-exercise-media.mjs` → `lib/training/data/exercise-media.json`:
  catalogue slug → assets (start, end, demo) with source URL, licence,
  author, modified, size. The slug mapping is **reviewed by hand**; nothing is
  attached by fuzzy name match. No migration (catalogue data, like
  `exercises.json`).
- Drawings: static SVG files (10–14 KB each). Videos: muted MP4 ~1–3 MB with
  poster, in a public read-only Supabase Storage bucket holding catalogue
  media only; the CSP gains `media-src` for that host. `preload="none"`, play
  on tap, one at a time; media never blocks logging a set.
- Priority: wave 1 = the owner's own exercises (templates + last 90 days,
  ranked by sessions — a list supplied by the owner, or one read-only count
  the owner approves); wave 2 = remaining staples covered by the sources. Known gaps:
  Everkinetic has no conventional deadlift, and some IDs lack a `dist/` SVG.
- **Gate:** media ships only after phases 12–13 are stable (13N and the
  parser's `original_text` are open). Design and the build script may be
  prepared before.

## 10. Implementation order

0 restaurant work committed separately (done, `e31090a`) · 0b status-bar test ·
1 tokens, type, motion utilities, band, per-theme `themeColor` · 2 tab bar +
capsule, More grid, Today · 3 live session, training home, library (no
media) · 4 Nutrition (usuals first, edit sheet, pips; retry tokens for the
remaining paths first, separately) · 5 Progress and secondary screens ·
gated: media. Each step is committed and pushed on its own, checked in both
themes at 360/390/430/1280 px, with tests, typecheck, lint and build.

Unchanged by the redesign: nutrition math and targets, safety floors, the
Gemini boundary, snapshots, RLS, the CSP except the one media host, the
service worker rule, and "no calories burned".
