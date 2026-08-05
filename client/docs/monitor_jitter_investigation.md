# Ship/nameplate jitter investigation — handoff (2026-08-03, resolved 2026-08-05)

Started as: "корабль дребезжит на мониторе 100 герц, причём не только корабль, но и ник с плашкой ранга". Widened into overlapping with the older `perf_stutter_investigation.md` (general FPS-dip jerk).

**RESOLVED 2026-08-05**: render-position interpolation (Option B from below) implemented and shipped default-ON. Full details, code locations, and the rollback path are in `client/docs/render_interp_fix_log.md` (steps A.0-A.3) — read THAT file for the current state of this specific fix, not this one. This file is kept for the diagnostic history (trace analysis, ruled-out candidates) that led to the fix.

**Still open, separate problem**: FPS dip in the first ~10s after game start (seen even on strong hardware — Ryzen 5600/RX5700XT/16GB — 90fps dips out of 100 max, then steady). Interpolation does NOT fix this (it only smooths the visual gap between physics steps, not a genuine FPS drop). This is the "Untested candidate" section below (HUD action-bar icon `prerenderTex` first-use cost, or JIT warm-up) — still unconfirmed, still needs a real trace bracketing game start specifically.

## Confirmed facts (don't re-litigate)

- **Only the player's ship (+ nameplate) visibly jitters, never mobs** — even though both use the exact same `body.setVelocity()` Arcade Physics mechanism (checked `Mob.js`, ruled out a physics-integration difference). Real reason: `cameras.main.startFollow(player.sprite, ...)` — camera chases the player specifically. Screen pos = world pos − camera scroll. A pre-existing fix (`GameScene.js` ~line 6828) recomputes camera lerp every frame from `dt` to be frame-rate independent: `camLerp = 1 - Math.pow(1-0.35, dt*60)`. Feeding a NOISY per-frame `dt` into that formula makes the camera's convergence uneven frame-to-frame → visible as the player (anchored near screen center) wobbling. A mob shows the *same absolute* camera-scroll jitter but it's masked by its own motion and isn't held to a "should sit still" expectation.
- Switching to another tab/app and back reliably reproduces jitter (browser throttles rAF while hidden; first frames back have wildly irregular `dt` — same "noisy dt" condition, different trigger).
- Jitter correlates with plain FPS dips generally ("да когда идет просадка фпс идут и дерганья" — user-confirmed). It's not one discrete bug, it's what an FPS dip *looks like* on the camera-follow target specifically.
- User reports jitter correlates with system RAM usage: tolerable <90% used, bad >90%. **Tension**: an older investigation (`perf_stutter_investigation.md` item 8, different machine) tested "free RAM to 30% used, stutter unchanged" and ruled memory pressure out. Not necessarily contradictory (that tested fixing an established pattern by freeing RAM after the fact; this is about live RAM-pressure correlation) but unresolved — test both directions deliberately on the SAME machine before trusting either.
- Real Chrome trace (`.json.gz`, parsed with local Python — `/c/Python314/python`, stdlib `gzip`+`json`) found 3 distinct stall types in one ~28s recording (only 3 gaps >25ms total — genuinely rare, matches "спонтанно"):
  1. ~190-324ms: `LargeScriptCatchup` — confirmed **DevTools recording artifact** (V8 inspector→Sources panel), not real for players without DevTools open.
  2. ~35-50ms: no attributable event on any thread — main thread just idle-gapped, compositor logged `DroppedFrame`. Never explained. Ruled out click/input correlation (user: a jerk can land 3-4s after a minimap click with nothing else happening in between).
  3. ~108ms: the **GPU process thread** (`CrGpuMain`) itself busy ~106ms while renderer waited. Real, non-DevTools stall. Prime suspect: `prerenderTex()` (`client/src/utils/prerenderTex.js`) — textures cache only AFTER first use; first-ever call per icon this session does a synchronous `tex.refresh()` (WebGL upload). Ship/mob textures ARE pre-warmed in `BootScene` (`_prepShipTex`) for this exact reason; `prerenderTex()` never got that treatment.

## Ruled out as candidates (user pushback, don't re-suggest)

- `Mob.js` AI-class icons (dash/shield-aura badge) — user: problem happens well before those would even show up.
- `MiningBase`/`ArmoredTrain` turret/cannon icons — user: problem happens on home maps and dungeons too, not just PvP/mining content.
- Click/input handler cost — ruled out by the 3-4s-delayed-jerk-after-minimap-click observation.

## Untested candidate (needs a real trace, not more guessing)

- **HUD action-bar icons** (`HudScene._rebuildActionBarIcons()` → `prerenderTex()`) — built once at game start, universal across all map types. Would explain why the dt-smoothing camera fix (below) had ZERO effect on the "right after starting the game" case specifically (that case may not be camera/dt-related at all — could be this GPU-texture-upload mechanism instead, just at start instead of at a sector-jump-encountered-new-icon). **Not confirmed** — need a trace bracketing the exact first 5-10s after login, not a general mid-session recording.

## Fixes tried this session

**Reverted (both made things worse or had a real cost — do not retry either):**
- `physics.arcade.fixedStep: false` in `main.js` — textbook fix for the ORIGINAL 60Hz-physics-vs-100Hz-render aliasing theory (confirmed via Phaser `World.js` source it does what it claims), but tanked FPS to 10-15 even on the 60Hz dev machine (physics/collision cost scales with render frequency, uncapped). Reverted.
- `fps.limit: 60` in `main.js` (Phaser's `TimeStep.stepLimitFPS`) — theory: keep physics+render on the same cadence without `fixedStep:false`'s cost. In practice its own delta-accumulator has enough timing slop to introduce NEW jitter even on 60Hz. Reverted.

**Kept (safe, not committed — user didn't ask):**
- EMA-smoothed `dt` fed into the `camLerp` formula, clamped to `[1/240, 1/20]`s as backstop against a huge dt right after a backgrounded tab resumes:
  ```js
  this._camDtSmoothed = this._camDtSmoothed==null ? dt : this._camDtSmoothed + (dt-this._camDtSmoothed)*0.15;
  const camDt = Math.min(Math.max(this._camDtSmoothed, 1/240), 1/20);
  const camLerp = 1 - Math.pow(1-0.35, camDt*60);
  ```
  User-confirmed result: not worse, subjectively better for tab-switch-return and sector-jump, but no perceptible change for "right after starting the game" (supports the HUD-icon theory above being a separate mechanism).

## Where the >60Hz-specific discussion landed (mid-discussion when tokens ran out)

Was discussing how to properly fix the ORIGINAL >60Hz physics/render mismatch (separate from the camLerp dt-noise fix, which doesn't address monitor Hz at all) without repeating today's 2 failures:

- **Rejected**: raising `physics.arcade.fps` from 60 to e.g. 120 (keep `fixedStep:true`, bounded cost unlike `fixedStep:false`). User correctly pushed back: (a) still real CPU cost, roughly 2x the physics/collision portion of frame time — risky on weak hardware (see the old ultrabook case in `perf_stutter_investigation.md`); (b) doesn't actually solve it for anything above the chosen number — a 180Hz or 240Hz monitor would still alias against a fixed 120Hz physics rate, just less often. Not a real fix, just moves the threshold.
- **Where we were headed next**: proper **render-position interpolation** — keep physics at 60Hz exactly as today (zero cost change), but on every RENDER frame (any Hz), compute the visually-drawn position as `lerp(prevPhysicsPos, currPhysicsPos, alpha)` where `alpha` = how far through the current fixed-timestep window we are. This is Hz-independent (no aliasing at 60, 100, 144, 240Hz — any of them) with NO added physics cost (physics tick rate literally unchanged). Cost is implementation complexity: need to snapshot prev/curr position per physics step, expose or approximate the accumulator's fractional progress (Phaser's Arcade `World` doesn't cleanly expose this via public API — may need to track wall-clock time since last physics step ourselves rather than reach into `world._elapsed`), and decouple "visual" position (sprite draw pos, nameplate pos, camera follow target) from "physical" body position (collision/gameplay, untouched) — for the ship AND, if needed, generalized to mobs/camera target.
- **Given today's 2-for-2 failure rate on physics-timing changes**: agreed to go slow, small steps, verify at each stage, on the SAME machine first (60Hz) to confirm no regression before trusting it'll also fix the 100Hz case — the 100Hz effect itself can only be truly confirmed on that other PC.

## Next session — concrete todo

1. Scope the render-interpolation approach in more detail before writing code — specifically how to get the physics-step "alpha" (fractional progress) without depending on Phaser internals that might change across versions.
2. Decide what needs interpolated visual position vs what can stay physics-driven: definitely the player sprite + its nameplate (the reported symptom); probably NOT mobs (never reported jittering, don't touch what isn't broken); camera follow target should probably use the SAME interpolated player position it's chasing, not raw body position.
3. Implement small, test on local 60Hz machine first (must show zero regression — no FPS drop, no NEW jitter, matching today's failure pattern to watch for), then ship a version for the 100Hz-monitor PC to actually confirm the original complaint is fixed.
4. Separately, if there's time: get a real trace bracketing "first 5-10s right after login" to confirm/refute the HUD-action-bar-icon prerenderTex theory for the "right after start" case that the camLerp fix didn't touch.
5. Separately: test the RAM>90% correlation deliberately (force high vs low RAM usage on the same machine) rather than relying on incidental observation.
