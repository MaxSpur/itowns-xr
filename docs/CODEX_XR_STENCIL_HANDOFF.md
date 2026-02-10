# iTowns XR Stencil Handoff Notes

Last updated: 2026-02-10

## Scope
- Project area: `index.html`, `main.js`, `modules/*`
- Goal: stable multi-globe stencil workflow for tabletop/XR scale, deterministic reload from dumped config.

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
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/main.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/stencil-system.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/controls.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/sources.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/public/configs/default.json`

## Fast Re-entry Checklist (future session)
- Open and skim this file first.
- Compare latest `default.json` and immediate post-reload dump if behavior regresses.
- Check whether regression is:
  - camera/target convergence,
  - counter-rotation solve,
  - source/elevation availability.
- If console warnings mention `removeFrameRequester` again, inspect `lookAt` vs `CameraUtils.stop` timing first.
