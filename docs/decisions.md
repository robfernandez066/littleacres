# Little Acres - Decision Log

Record of design and process decisions. One entry per decision, added
directly below this header, NEWEST FIRST - strictly, since the 2026-07-17
log repair. Each fact/decision is recorded ONCE, here; status.md and
roadmap.md carry at most one-line pointers.

**Archives (entries moved intact, never edited):**
- docs/archive/decisions-archive-2026-07-14-to-2026-07-16.md (review repair cut through T3.3a2/new-art era)
- docs/archive/decisions-archive-2026-07-07-to-2026-07-13.md (project setup through wave 2 and the first gate)
Archive cadence: automatic whenever the active log exceeds 40 entries or a
wave closes - entries whose work is committed+pushed and older than the
in-flight wave move intact to a new dated archive file.

Format (hard cap ~120 words per entry; longer material becomes a design doc
under docs/design/ with the entry linking to it; review narratives stay out -
one sentence of verdict plus the ruling is enough, the diff is the record):

## YYYY-MM-DD - Short title
**Context:** why this came up (max 2 sentences)
**Decision:** what was decided (max 3 sentences)
**Trigger:** task/report that prompted it (if any)

---

## 2026-07-17 - T3.3b R1 East Meadow + placement-depth polish SHIPPED (one combined commit)

**Context:** R1 regions plus a run of on-device fixes (base/band seam gap, notice-board footprint, decor/structure depth over plots, fence shadow removal, birdbath reskin) all landed uncommitted in one tree sharing FarmScene/atlas, forcing a combined commit.

**Decision:** USER TEST passed; shipped as ONE commit (schema v19, tests 503): purchasable East Meadow (7,500 coins / L7, +6 plots, cap 22, region sign + dim overlay + one-time two-finger hint), region-aware placement domain with base+band merged (seam gap fixed), 5-tile notice-board footprint, plots re-layered as a y-ordered ground sub-layer below all standing objects so decor/crops/structures render on top (owner pick B), fence casts no shadow, birdbath art. Owner checkpoint (sweep-vs-pan) before R2/R3.

**Art Studio sync flags owed (owner re-syncs tool at leisure):** WORLD_WIDTH 1440->1952; DECOR_X/Y_MIN/MAX now derived from PLOT_PLACEABLE_* (not plain literals); STRUCTURE_FOOTPRINT_OFFSETS.noticeBoard 1->5 tiles (anchor now included); placeable domain is region-aware (new blocker class for the tool's debug panel).

**Trigger:** T3.3b + r1/r2/r3/r3b reports, 2026-07-17.

## 2026-07-17 - T3.3b R1 East Meadow NUMBERS LOCKED (owner picks); prompt issued

**Context:** The land-camera FINAL v3 contract requires owner approval of region numbers at prompt time; R1 geometry was never locked.

**Decision:** R1 = a 4-tile-column east band (world grows 512px east, visible dimmed pre-purchase, camera can pan over it); grants 6 plots via the existing 5C flow with the entitlement cap rising 16 -> 22; price 7,500 coins, level-7 gate; purchase via a region sign (reused sign art) standing inside the locked band. Schema v19 (regionsUnlocked + one-time two-finger-pan-hint flag); decor/fence clamp-bounds growth folds in; tint-dim fallback until overgrowth art lands.

**Trigger:** Owner picks 1A / 2A / 7,500-at-L7 / 4A, 2026-07-17.

## 2026-07-17 - Fence-snap redesign DROPPED (owner)

**Context:** The redesign had been deferred pending an owner Art Studio mockup; the era bundle shipped with current fence behavior.

**Decision:** Dropped entirely - the shipped chain-snap + plot-edge-snap model (with the accepted apex-notch gate look) is final. Removed from the queue; the future fence-gate art piece is a separate owner-paced item and is unaffected.

**Trigger:** Owner instruction, 2026-07-17.

## 2026-07-17 - T3.3s-r2e review PASS (both rounds) -> USER TEST (2-minute look), then the era-bundle commit

**Context:** Art Studio structure sync applied per the 2026-07-17 owner ruling: farmhouse 2x2 footprint + (137,9) render offset, board single-tile footprint + (116,-11) offset, positions re-derived to (933,521)/(912,1269); anchor tiles now deliberately outside both footprints. Mid-task incident: the coder "repaired" the owner's deliberate single-tile board edit as corruption - owner hand-edits must reach the PM or arrive as change requests (rule recorded in pm-process.md).

**Decision:** Diff verified tile by tile across both rounds; anchor-outside-footprint pinned with new tests. Verdict: USER TEST - a quick on-device look at the re-positioned art - then ONE commit ships T3.3s-r2..r2e (tests 477).

**Trigger:** T3.3s-r2e coder reports, 2026-07-17.

## 2026-07-17 - Per-task workload diet ADOPTED (standing conventions; full text in private/misc/pm-process.md)

**Context:** Owner directive to cut per-task documentation overhead without weakening coder isolation or losing decision history.

**Decision:** Task prompts assemble from the fixed-slot template in pm-process.md. Default post-report doc write is ONE decisions.md entry; status.md changes only when in-flight state changes, and its header facts (schema, tests, commit) only on an owner-confirmed commit. Verdict replies go lean (COMMIT = message + git commands; CODER FIX = the fix prompt; USER TEST = the numbered steps); USER TEST scripts reference the reusable save-backup and regression blocks in pm-process.md. CLAUDE.md is the single canonical coder guide (AGENTS.md reduced to a pointer stub for non-Claude agents); PM-marked TRIVIAL tasks may file a collapsed report. PM handoffs are read-once bootstraps: generated only when the owner announces a fresh PM session, carrying only in-flight context not yet in the docs, discarded to private\to_delete\ after takeover (boot order lives in pm-process.md).

**Trigger:** PM directive, 2026-07-17.

## 2026-07-17 - Decision log REPAIRED and archived (metadata only; entry text intact)

**Context:** The active log had four 2026-07-15 entries misfiled above newer ones, two entries misdated 2026-07-18 (written 2026-07-17), and 82 shipped-era entries inflating it.

**Decision:** Re-sorted strictly newest-first; corrected the two 2026-07-18 headers to 2026-07-17; moved the 82 entries dated 2026-07-14 through 2026-07-16 intact to docs/archive/decisions-archive-2026-07-14-to-2026-07-16.md. The active log now holds only the in-flight 2026-07-17 wave. No entry text was changed.

**Trigger:** PM directive, 2026-07-17.

## 2026-07-17 - T3.3s-r2c + r2d reviews PASS: the era bundle is code-complete (final USER TEST then ONE commit)

**Context:** r2c (symmetric 3x3 farmhouse footprint superseding measurement - Art Studio owns refinements; green/red preview re-depthed above ground sprites at lifted-structure-depth minus 2 so blocked tiles shade OVER crops; both r2 collateral test re-aims reverted) and r2d (pack-time directional cast shadows: generateCastShadow squash 0.27 / shear 0.40 / blur 6 / baked alpha 0.30 / blur pad 12; 18 `<frame>_shadow` companions with proper trim metadata so the runtime aligns via two constants - SHADOW_TUCK_RATIO 0.45 + SHADOW_CANVAS_PAD 12 MUST-MATCHing the packer; ground_shadow ellipse REMOVED; atlas +58,336 bytes = +3.1%; the coder's vertical-flip "deviation" was the design's own geometry, accepted). Baked-alpha tradeoff on record: shadow opacity changes now require a repack. Tests 474 throughout.

**Art Studio sync flags delivered to owner:** ground_shadow removed from the must-exist frame list + 18 new shadow frames; shadow frames use trimmed:true metadata (parser heads-up); SHADOW_* constants replaced by SHADOW_TUCK_RATIO/SHADOW_CANVAS_PAD with shape numbers relocated to pack-atlas.mjs.

## 2026-07-17 - SHADOW DIRECTION SETTLED (owner-picked from PM mocks): directional cast silhouettes, sun from top-right, pack-time generated

**Context:** Three shadow attempts failed in sequence (invisible gradient ellipse; visible-but-disliked solid-core ellipse; runtime mirror silhouette that read as a POND REFLECTION - owner screenshot). Owner set the design principle: light comes from a fixed direction (sun top-right), shadows fall lower-left and are NOT halos around the object. PM iterated mocks on real art: v1 detached (owner: "looks like the object is flying"), v2 attached-at-base gapped at the iso sides, v3 tucked under the sprite so the shadow emerges from beneath the base - owner picked "between the two, A1" -> final recipe: squash 0.27, shear 0.40 leftward, blur ~6px, baked alpha 0.30, tuck 45% of shadow height under the base.

**Architecture (the actual rethink the owner asked for):** shadows generate at PACK TIME in pack-atlas.mjs from each shadowed frame's own alpha mask into `<frame>_shadow` frames - per-sprite shaped, soft-blurred (impossible with runtime tint copies), modest atlas cost, and every future art regeneration gets correct shadows automatically on repack. Runtime just draws the frame. r2c's runtime mirror machinery retires; flipped decor mirrors its shadow's shear (accepted - imperceptible at this alpha/blur; structures never flip). T3.3s-r2d issued.

## 2026-07-17 - T3.3s-r2 + r2b review PASS -> USER TEST: the feel-and-look bundle (free-follow drag, footprints, shadows, meadow, grid)

**Context:** r2 delivered against the pre-correction prompt (board briefly 216, meadow missing); r2b corrected both (board back to 240, rename kept; meadow live) plus linter ignores for the owner-private areas. Combined 1122-line diff reviewed. Highlights: free-follow structure drag with the sprite tracking the finger while isStructureAnchorFree remains the single authority for BOTH the green/red preview and the nearest-legal-anchor commit (192px radius); badge bounce tween killed during drags and rebuilt on settle with shared anchor math; faint placement grid (0.2 alpha) for grid-snapped lifts ONLY (owner rule honored); dev.footprints() overlay with domain wash, tick-tracked; ground_shadow regenerated as solid-core smoothstep pool (old center-peaked gradient documented as mathematically invisible) with runtime defaults 1.1/0.35; meadow texture_a is the world-wide default at native scale (verified seam-free at the REAL zoom ceiling 1.6 - coder corrected the prompt's fictional 2.0), one TileSprite replacing ~600 tile images (strictly cheaper; 60fps sustained). FARMHOUSE_DISPLAY_HEIGHT rides at the owner's live-tuned 420; footprint re-measured there: 7 -> 14 tiles (OWNER VETO PENDING via dev.footprints()); board 4 unchanged. Two accepted MUST-MATCH mirrors in FarmScene (sign tiles, per-tile legality). Tests 474.

**Verdict:** USER TEST (the big phone session: meadow, shadows, drag feel, footprint veto, grid visibility, regression), then ONE commit ships r2+r2b+.gitignore/linter changes.

## 2026-07-17 - Art Studio standing sync rules ADOPTED (9 rules, full text in private/misc/art-studio-workflow.md)

**Context:** The tool's agent sent standing rules for keeping the game and the Art Studio in sync. Adopted wholesale into the private workflow note. PM operational changes: prompts touching the parse surface (config/farm/decor/crops/iso/FarmScene/gameState/atlas) carry a sync-flag duty in their report template; a protected-constants name registry is checked against every reviewed diff; renames get `ART STUDIO SYNC: <file> - <what> (<old> -> <new>)` lines in owner wrap-ups. Two flags already owed from r2 (delivered to owner via this entry): FarmScene.ts STRUCTURE_DISPLAY_HEIGHT -> NOTICE_BOARD_DISPLAY_HEIGHT rename; config.ts STRUCTURE_FOOTPRINT_OFFSETS.farmhouse reshaped 7 -> 14 tiles. Never a dev task inside tools/art-studio/; game tasks never depend on the tool; port 5199 reserved.

## 2026-07-17 - Private-area reorg (owner request): one root private/ folder with to_delete/ and misc/

**Context:** Owner disliked the scattered private layout. Reorganized: `private/to_delete/` (all 41 disposable transfer files - review diffs, raw art; was root _to_delete/) and `private/misc/` (monetization report + art-studio workflow note; was docs/private/). Whole-directory moves via the folder connection, nothing left behind. `.gitignore` now ignores `private/` (one entry replaces two); `tools/art-studio/` stays where it is (its server reads repo-relative paths) and stays ignored. NEW CONVENTIONS: review diffs go to `private\to_delete\<name>.diff`; raw art transfers to `private\to_delete\<name>_raw.png`; the PM's standing notes live in `private\misc\`. docs/ remains the public documentation only.

## 2026-07-17 - Owner "Art Studio" tool: NOT committed (private, gitignored); change-request workflow adopted; .gitignore gap FOUND and fixed

**Context:** Owner built a standalone owner-only sandbox (tools/art-studio/, port 5199 - reserved) that parses live repo constants and emits structured "ART STUDIO CHANGE REQUEST" blocks. PM decisions on the owner's two questions: (1) NOT committed - the repo is public and the owner explicitly wants the tool private; whole directory gitignored; owner advised to keep an off-repo backup (untracked = no history). (2) Standing workflow note YES, but in docs/private/ (not public docs), at docs/private/art-studio-workflow.md - full protocol recorded there (staleness check via old->new values, PM scopes derived consequences the tool does not compute, session notes beat numbers, caveats force re-verification, raw reports never forwarded to the coder).

**FOUND while editing:** .gitignore did NOT contain the docs/private/ and _to_delete/ entries the 2026-07-15 privacy decision recorded as added - the protection was missing in the working tree. Fixed now (all three entries present).

**Addendum (same day): ALL CLEAR.** Owner ran `git ls-files docs/private _to_delete tools/art-studio` - empty output. Nothing under those folders was ever tracked or committed; the public repo and its history are clean. The .gitignore fix rides the next commit.

## 2026-07-17 - T3.3s SHIPPED (one commit): the farmhouse and notice board are the player's to move

**Context:** Owner passed the phone test and pushed. Movable structures with schema v18 and full mutual exclusion are live. Next, in order: owner live-tunes shadows (SHADOW_WIDTH_RATIO/SHADOW_ALPHA) and structure display sizes (FARMHOUSE_DISPLAY_HEIGHT + board equivalent) in the quiet window; those values feed T3.3s-r2 (footprint re-measure with owner veto via the new restrictions dev overlay, free-follow structure drag with nearest-legal commit); then the ground-switch task (meadow texture in, diamond tiles out - master ready PM-side).

## 2026-07-17 - T3.3s + r1 + r1b review PASS -> USER TEST (phone); movable structures complete with full mutual exclusion

**Context:** The three-part chain reviewed as one 1794-line diff. T3.3s: schema v18 stores each structure's grid anchor; footprints and render positions derive from anchor + config offset tables, with migration pinned by PIXEL-IDENTITY and footprint-set-identity tests; isPlotTileFree consumes structure footprints dynamically, so plot placement/chain/batch/fence-edge systems inherit moved structures for free; the gesture classifier gained a third movable kind ('structure') without touching classification rules; arrange-mode structure taps select (handleStructureDown self-gates), outside-arrange taps unchanged. r1: nothing places on permanent objects - isStructureAnchorFree (one authority shared by store AND live preview - illegal anchors never even preview) blocks plots/other-structure/sign-pre-expansion; setDecorationTransform refuses commits whose CLAMPED anchor lands on any permanent footprint. r1b: refused decor commits snap the sprite+shadow back from state with the locked-plot wiggle. Detail catches verified in review: badge tween re-anchors with the board, abandoned mid-exit lifts snap back, pulse/coin-flight targets read live positions. Tests 474.

**Rulings on the record:** structures MAY park over a decoration's anchor (blocking would compound the owner's restrictiveness complaint; Put Away rescues a covered piece). Owner's UX feedback parked for r2 (one thing at a time, owner's words): farmhouse bigger / board smaller (owner live-tunes display constants and reports values), footprint re-measure at new sizes with owner veto via a NEW dev restrictions overlay (structure footprints + placeable-domain boundary + live green/red footprint under a dragged structure), free-follow drag with nearest-legal commit. Snapping on/off toggle REJECTED (PM): free-form structures would break the tile-aligned collision model.

**Verdict:** USER TEST (phone) then ONE commit for T3.3s+r1+r1b; owner shadow-tuning window follows the commit; ground-switch task after that.

## 2026-07-17 - Meadow ground APPROVED (texture 2, warmed): the diamond-tile checkerboard retires; full-scene mock signed off

**Context:** Owner asked to replace the two-tone diamond grass that clashed with every epoch-15 asset. PM steered away from a single whole-world image (heavy download/GPU, breaks on region growth) to a seamless repeating meadow texture. Three candidates auditioned empirically: seam-fixed (offset-wrap + cross-fade), 4x4 tiled at game zooms, measured for low-frequency repetition AND color distance to the notice board's tuft green (169,185,72 - the owner's stated color anchor). Texture 2 won tiling decisively (low-freq contrast 4.48 vs 5.15/6.97 - texture 3, closest on color, showed a strong diagonal repeat rhythm); its slightly cool green was warmed 60% toward the board green (final mean 162,184,75). Full-scene mock (meadow + v6/v2 plots + normalized crops + farmhouse + board) approved by owner: "I like it."

**Pipeline notes:** final master ready PM-side, NOT staged - the ground-switch coder task (texture in, diamond tiles out; wiring exists via grass_texture assets + ground-mode switch) queues AFTER T3.3s+r1 ships to keep FarmScene single-writer. Known losses accepted: the checkerboard's placement-grid hint (follow-up: faint arrange-mode grid overlay ONLY if placement feels floaty); mock-observed nit: empty furrowed plots run lighter/warmer than occupied beds - reads as tilled-vs-planted, owner can request a nudge later.

## 2026-07-17 - T3.art-2 review PASS; the "floating" mystery was a BROKEN ATLAS (missing generated ground_shadow frame); OWNER SAVE INCIDENT (partial reconstruction)

**Context:** Coder delivered the structure-shadow task with two findings that beat the premise. (1) Farmhouse and notice board have had generated shadows since T3.9 - the task premise was wrong; the REAL defect: the earlier art repack produced an atlas missing the GENERATED ground_shadow frame, so every shadow in the game (structures AND decor) rendered invisibly - the actual cause of the owner's floating complaint. Coder proved it by pixel sampling (zero shadow pixels pre-regen) and fixed it by re-running pack:atlas. (2) The expand sign genuinely lacked a shadow - added with the standard geometry but depth = sign base y-1 (NOT sign.depth-1: the sign renders at the floating-text tier, and the usual rule would have covered crops); visibility routed through a new refreshExpandSign wrapper at all three call sites so the shadow can never orphan. Mirrored EXPAND_SIGN constants accepted as a documented wart (cleaned up naturally by the movable-structures task when positions become data). No ratio tuning needed. Tests 455.

**SAVE INCIDENT (logged for the record):** the repack's page reload wiped the coder's in-page backup of the owner's save before restore. Reconstructed from live derived state: most data authentic; the 4 row-3 plots came back EMPTY (crops lost) and coins ESTIMATED at 1,500 (last verified 957 + subsequent play). Owner sanity-checks and adjusts via dev tools. Coder process mandate going forward: disk-persisted backup BEFORE any test-save import. PM addendum to the convention: any task expecting a repack or reload treats the owner save as radioactive.

**Atlas provenance:** assets/atlas.png in the tree is the coder's re-run (correct output, restored the missing frame). Deterministic packer means owner re-running npm run pack:atlas reproduces it byte-stable from the same staging - owner re-runs once to own the artifact, then commits. Verdict: art-1 + art-2 share ONE code commit; atlas + json get the ART commit.

## 2026-07-17 - Code wave CONFIRMED SHIPPED (3054160, pushed); PM git-check left a lock file - rule hardened: NO git via the folder connection, ever

**Context:** Owner asked PM to verify the T3.3a2+r3c+r1 commit. PM ran read-only git log/status through the folder connection: commit 3054160 confirmed at HEAD, branch even with origin (committed AND pushed; tests 455 live). COST: the connection cannot delete files, so git's transient index.lock could not be unlinked - a stale .git\index.lock may block the owner's next git command (fix: del .git\index.lock). Rule hardened: PM never runs git through the connection again, read-only included; commit verification = owner pastes git log output.

## 2026-07-17 - The new-art field completed in one sitting: plots (v6 + owner's occupied v2), farmhouse, 18 crop-soil normalizations; T3.art-1 delivered; T3.art-2 issued; movable structures queued

**Context:** After the v3 field "disaster" (stray cleanup specks poisoned the packer's diamond measurement - plot_occupied is the alignment REFERENCE, so both tiles rendered squashed with gaps), the plot masters went through: straightening to an exact 2:1 diamond + thin repainted lip + lightening toward the crop-mound tone (v4-v5), then a corner-glitch fix after the owner caught dark slivers the PM's seam-focused zooms missed (v6). Owner then generated a superior occupied-plot raw (v2): straight edges and thin lip AT THE SOURCE - adopted as-is (white-strip + downscale only). LESSON BANKED: prefer regenerating cleaner source art over heavy PM processing; and the PM announces every processing step on owner art in one line before it lands (trust incident: owner asked "did you modify the image without telling me?" - the changes had been narrated but scattered; now they are itemized).

**Crop soil normalization (owner task to PM):** all 18 crop stage masters' soil mounds re-toned to the occupied plot's palette via per-channel affine match on masked soil pixels (lower-half + brown filter; texture preserved by matching std 70% toward reference; plants/berries/roots untouched). Glowberry needed a mauve-inclusive mask after the owner spotted a purple fringe (its soil was painted mauve, not brown). All staged after owner approved the 36-cell before/after sheet.

**Also this sitting:** T3.art-1 (dirt path + all placed dressing removed; editor kept, blank slate) delivered - review PASS pending the diff; notice-board dressing loss accepted by owner (option 1: redress in new art era later, PM writes decal prompts on request). T3.art-2 issued: structures get decor's generated ground shadows (the systematic anti-floating fix; baked-in grass reserved as charm for hero structures - the regenerated notice-board prompt includes grass at the post bases). QUEUED as fresh-session task after art-2: MOVABLE farmhouse + notice board (owner request, move only, NO scaling) - PM design calls locked: structures join the long-press/selected lift system, snap to the hidden tile grid, blocked-tile footprints travel with them, drop refused (wiggle + snap back) unless every footprint tile is free and in-bounds, tap actions unchanged outside arrange, positions enter the save (schema v18, migration defaults = current positions).
