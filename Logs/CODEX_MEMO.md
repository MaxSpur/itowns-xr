# iTowns XR Stencil Handoff Notes

Last updated: 2026-02-10

## Scope
- Canonical app workspace: `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/`
- Do not treat repo root `index.html` / `main.js` / `modules/*` as the primary runtime anymore.
- Goal: stable multi-globe stencil workflow for tabletop/XR scale, deterministic reload from dumped config, now running against npm `itowns@next`.

## Repository Layout (current)
- App runtime and active development:
  - `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/index.html`
  - `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/main.js`
  - `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/modules/`
  - `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/public/`
- GitHub Pages output target:
  - `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/docs/`
- Important: `apps/itowns-xr-next/vite.config.js` currently sets `build.emptyOutDir = true` with `outDir = '../../docs'`, so `docs/` is a generated folder and manual files inside it can be deleted on build.

## System Architecture (project side)
- `main.js`
  - bootstraps config loading, creates `GlobeView`, installs custom controls, creates globe layers, applies stencil system, runs startup restore loop.
- `modules/view-setup.js`
  - creates `itowns.GlobeView` with renderer/XR options and visual defaults.
- `modules/globes.js`
  - attaches one context globe + two child globe layers (origin/destination), then applies saved transforms.
- `modules/stencil-system.js`
  - owns stencils, cylinders, context mode, counter-rotation, scaling, config dump/apply, and UI wiring.
- `modules/controls.js`
  - replaces fragile default zoom behavior with no-tilt zoom path, adaptive clipping, and camera-updater guards.
- `modules/sources.js`
  - builds WMTS source objects and normalizes risky elevation settings.
- `modules/config.js`
  - resolves `/public/configs/default.json` (or query override) and fetches app config.

## Core Interaction Model (important invariants)
- Picking and targeting are context-globe-centric.
- Context center is generally derived from origin+destination targets (`deriveCenterFromTargets: true`).
- Repositioning masks changes X/Y placement intent; vertical/counter-rotation corrections are handled separately.
- Scale slider and radius slider are decoupled:
  - radius slider = cylinder physical/view radius control.
  - scale slider = globe content scaling around stencil centers.
- Counter-rotation is solved in context/world coordinates, not screen-space, so camera heading changes should not break alignment.
- Saved "target views" must not store globe/cylinder world transforms.
  - They should only store `originTargetGeo`, `destinationTargetGeo`, and `scale`.
  - Applying a saved view should behave like two `Pick target` operations plus scale update, while leaving camera and cylinder placement intact.

## Config Snapshot Contract
- User-facing snapshot entry point: `window.__itownsDumpConfig()`.
- Load path: `public/configs/default.json` (or `?config=...`), via `modules/config.js`.
- Persisted user config should include:
  - `sources` (ortho + elevation)
  - `view` (`placement`, `controls`, `camera`)
  - `globes.transforms` (+ `runtimeSnapshot`)
  - `scale`, `contextMode`, `stencils`
- Internal computed fields (like counter-rotation state) are not required in config.

## iTowns Internals Discovered (important for future work)
- `GlobeControls` keeps private orbit state around:
  - internal `cameraTarget` object,
  - internal `spherical` / `sphericalDelta`,
  - state machine events (`zoom`, `orbit`, `pan`, etc.).
- `GlobeControls.lookAtCoordinate(...)` delegates to `CameraUtils.transformCameraToLookAtTarget(...)` for non-animated calls.
- `CameraUtils.transformCameraToLookAtTarget(...)` installs `addPlaceTargetOnGround(...)`:
  - it registers a `BEFORE_RENDER` frame requester that repeatedly samples DEM (`DEMUtils.getElevationValueAt`).
  - if DEM tiles fail or arrive late, this can keep nudging camera target and therefore camera transform.
- `CameraUtils.stop(view, camera)` removes this updater, but calling stop at the wrong moment can race with frame requester registration.
- The warning:
  - `Invalid call to removeFrameRequester: frameRequester isn't registered`
  - comes from that exact race (remove attempted before register has landed).

## Root Causes Observed During Session
- Startup restore drift was not only "camera position mismatch":
  - camera position could match while `GlobeControls` target had drifted.
  - then first user interaction snapped orientation/range.
- Early user interaction could race with late restore/init callbacks:
  - delayed restore pass could re-apply camera/target after user started navigating.
- DEM 404 bursts (elevation WMTS) amplified instability by continuously exercising place-target-on-ground logic.
- Steep negative tilts in saved configs can conflict with default GlobeControls startup tilt clamp path if applied too early through the standard placement path.
- After migration to `itowns@next`, drag start (`pointerdown`) can transiently report a near-zero control range/target.
  - Our adaptive clipping logic in `modules/controls.js` used that transient range to recompute `camera.far`.
  - Result: far plane briefly collapsed and all stencils/globes disappeared while mouse drag was active.
- In `itowns@next`, GlobeControls drag path can occasionally push camera/target into non-finite values.
  - Stack signature: `GlobeControls.handleDrag -> update -> GlobeView CAMERA_MOVED listener` then
    `TypeError: coordinates must be finite numbers` from `Coordinates.as(...)`.
  - Once this happens repeatedly, the scene can vanish until controls state is reset.
- `GlobeView` default `dynamicCameraNearFar` listener is a secondary trigger:
  - On every `CAMERA_MOVED`, it converts camera ECEF position to layer CRS.
  - If camera position is transiently non-finite, this throws from `checkCoord` and can cascade errors.
- Small-scale drag offset root cause:
  - `View.getPickingPositionFromDepth` uses a special branch when `logarithmicDepthBuffer` is enabled.
  - That branch is approximate (explicit TODO in iTowns source) and can shift MOVE_GLOBE anchor from cursor at tabletop scales.

## Critical Fixes Applied
- Camera restore stability:
  - `main.js` repeatedly enforces camera pose plus controls target during startup.
  - Restore completion now requires convergence of:
    - camera position,
    - camera quaternion (if present in config),
    - controls target position.
  - restore re-run after globe init is skipped if user already interacted.
- Controls race fixes:
  - `modules/controls.js` wraps `lookAtCoordinate` and stops `CameraUtils` place-target updater after completion.
  - added `lookAtInProgress` guard so stop calls are not triggered from `CAMERA_MOVED` while a programmatic lookAt is still in progress.
  - removed duplicate pre-init control priming pass; kept post-init priming.
- DEM 404 mitigation:
  - `modules/sources.js` normalizes `SRTM3/WGS84G` elevation zoom to reduce invalid requests:
    - `zoom.min >= 1`
    - `zoom.max <= 10`
  - this removed the heavy 404 spam in current setup and improved startup stability.
- Startup loading warmup:
  - `main.js` now runs a short post-load camera-based `notifyChange` interval burst.
  - Triggered after config apply, on globe initialized, and after delayed control priming.
  - Prevents the "must nudge camera to start tile/elevation loading" behavior.
- Post-`itowns@next` drag stability:
  - `modules/controls.js` now freezes adaptive clip recomputation during active pointer interaction and reapplies clipping on pointer release.
  - Clipping updates ignore invalid/tiny transient ranges (`<= 0.01`) that occur during drag initialization.
  - Removed per-`CAMERA_MOVED` `CameraUtils.stop` loop; this path could race with iTowns internal requester registration and amplify instability.
- Non-finite camera-state recovery:
  - `modules/controls.js` tracks a last known-good camera pose (`position`, `quaternion`, controls target).
  - Wrapped `controls.update(...)` to catch finite-coordinate failures and restore the last known-good pose.
  - Also restores if update returns with non-finite camera/target values, then forces controls out of active drag state (`states.onPointerUp()`).
- Disabled internal GlobeView dynamic near/far:
  - `modules/view-setup.js` now creates `GlobeView` with `dynamicCameraNearFar: false`.
  - Clipping is now fully owned by custom controls logic, removing `GlobeView`'s finite-coordinate conversion path during camera-moved events.
- Disabled renderer log-depth in this app:
  - `modules/view-setup.js` now sets `renderer.logarithmicDepthBuffer = false`.
  - This forces the exact depth unprojection path for picking and improves cursor-locked drag at small scales.
- Cursor-locked drag behavior:
  - In `itowns@next`, `enableDamping=true` causes noticeable drag lag/inertia in `MOVE_GLOBE` (map does not stay glued under cursor).
  - For this app, `modules/controls.js` sets `controls.enableDamping=false` to match precise drag feel from iTowns examples.

## Known Remaining Behavior
- If user moves camera extremely early during startup, cylinders can still briefly disappear once, then recover quickly.
- This appears tied to async tile/elevation readiness windows, not major config mismatch.

## Practical Guardrails for Future Edits
- Do not make screen-space bearing the source of truth for counter-rotation.
- Do not tie cylinder radius directly to scale slider value.
- Do not persist internal computed alignment state as user-editable config requirements.
- Keep restore logic idempotent and tolerant of async layer readiness.
- Prefer explicit camera+target enforcement and convergence checks over one-shot `lookAtCoordinate` restore.
- Any new startup hook that calls `lookAtCoordinate` should consider CameraUtils updater races.
- Treat control-event range values as potentially transient/invalid during interaction start in `itowns@next`; do not drive clipping directly from unguarded range events while pointer is down.
- Treat `CAMERA_MOVED`/drag updates as potentially non-finite under `itowns@next`; keep a recoverable last-good camera/target snapshot in custom controls code.

## How Config Should Be Interpreted
- User intent fields:
  - sources, globe transforms, stencil targets/radii/opacity, context mode, camera view, scale.
- Derived/runtime fields:
  - counter-rotation angle state, temporary alignment intermediate values, debug-only diagnostics.
- If context center is derived, context target center in config should not override origin+destination target logic except for explicit opt-out.

## Saved Views Persistence (new)
- Storage key: `localStorage["itowns.xr.savedTargetViews.v1"]`.
- Entry shape:
  - `id`, `name`, `createdAt`, `updatedAt`
  - `scale`
  - `originTargetGeo` (`EPSG:4326`)
  - `destinationTargetGeo` (`EPSG:4326`)
- Critical conversion detail:
  - Save path must convert stencil world center -> globe local (`root.worldToLocal`) -> geo.
  - Apply path must convert geo -> globe local reference CRS -> world (`root.localToWorld`) before rotation.
  - This is what keeps cylinders fixed in XR/world while changing only map content.
- Apply sequencing detail:
  - During "apply saved view", suppress auto vertical/cylinder alignment side effects.
  - Rotate both globes to their saved targets first, then run a single counter-rotation solve.
  - If this order is not respected, repeated apply can drift or require multiple clicks.
- Convergence detail:
  - Some configurations need iterative counter-rotation (non-linear residual after one solve).
  - Saved-view apply now runs a bounded internal solve loop (re-target + counter-rotation + residual check) so one click converges.
  - Apply now ends with a short camera-based refresh burst so newly visible tiles load without manual camera movement.
- Current status:
  - Saved-view save/apply/delete UI with `localStorage` persistence is working.
  - Apply is deterministic across repeated clicks and large target changes.

## High-Value Debug Commands
- Dump user config: `window.__itownsDumpConfig()`
- Dump debug snapshot: `window.__itownsDumpDebugState()`
- Counter-rotation diagnostics:
  - `window.__itownsCounterRotationDebug()`
- `window.__itownsCounterRotationWatch(250)`
- `window.__itownsCounterRotationWatchStop()`
- Apply config manually: `window.__itownsApplyConfig(jsonObj)`

## Validation Workflow That Worked
1. Arrange scene manually (targets, mask positions, scale, camera).
2. Dump config with `DUMP CONFIG`.
3. Save dump to `public/configs/default.json`.
4. Reload and verify:
  - cylinders visible at load,
  - scale slider label and effective scale match,
  - counter-rotation alignment preserved when toggling context mode,
  - first interaction does not cause persistent drift.

## Environment Constraint Noted
- Local shell npm/node in this Codex environment could not run project scripts:
  - `Cannot find module 'node:path'`
- Runtime validation relied on user browser testing and config dump diffs rather than local `npm run dev` execution.

## Files Most Relevant Next Session
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/main.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/modules/stencil-system.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/modules/controls.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/modules/sources.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/public/configs/default.json`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/apps/itowns-xr-next/vite.config.js`

## Fast Re-entry Checklist (future session)
- Open and skim this file first.
- Compare latest `default.json` and immediate post-reload dump if behavior regresses.
- Check whether regression is:
  - camera/target convergence,
  - counter-rotation solve,
  - source/elevation availability.
- If console warnings mention `removeFrameRequester` again, inspect `lookAt` vs `CameraUtils.stop` timing first.
