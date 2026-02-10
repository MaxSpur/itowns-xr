# iTowns XR Stencil Handoff Notes

Last updated: 2026-02-10

## Scope
- Project area: `index.html`, `main.js`, `modules/*`
- Goal: stable multi-globe stencil workflow for tabletop/XR scale, deterministic reload from dumped config.

## Current Working Model
- Interaction/picking is context-globe-centric.
- Origin/destination stencils derive context center (`deriveCenterFromTargets: true` by default).
- Counter-rotation is computed in context/world space (not screen space), so camera heading changes should not break it.
- Scale slider changes globe content scale around stencil centers; cylinder radii are controlled independently by radius sliders.

## Config Snapshot Contract
- User-facing snapshot entry point: `window.__itownsDumpConfig()`.
- Load path: `public/configs/default.json` (or `?config=...`), via `modules/config.js`.
- Persisted user config should include:
  - `sources` (ortho + elevation)
  - `view` (`placement`, `controls`, `camera`)
  - `globes.transforms` (+ `runtimeSnapshot`)
  - `scale`, `contextMode`, `stencils`
- Internal computed fields (like counter-rotation state) are not required in config.

## Critical Fixes Applied
- Camera restore stability:
  - `main.js` enforces camera pose + controls target repeatedly during startup.
  - Restore completion now checks camera position, quaternion (if present), and controls target convergence.
  - Restore re-run after globe init is skipped if user already interacted.
- Controls race fixes:
  - `modules/controls.js` wraps `lookAtCoordinate` and stops `CameraUtils` place-target updater after completion.
  - Guard added to avoid stopping updater mid-`lookAt` (prevents `removeFrameRequester` warning race).
- DEM 404 mitigation:
  - `modules/sources.js` normalizes `SRTM3/WGS84G` elevation zoom to reduce invalid requests:
    - `zoom.min >= 1`
    - `zoom.max <= 10`

## Known Remaining Behavior
- If user moves camera extremely early during startup, cylinders may still briefly disappear once, then recover quickly.
- This is likely due to asynchronous tile/elevation readiness timing rather than config restore mismatch.

## High-Value Debug Commands
- Dump user config: `window.__itownsDumpConfig()`
- Dump debug snapshot: `window.__itownsDumpDebugState()`
- Counter-rotation diagnostics:
  - `window.__itownsCounterRotationDebug()`
  - `window.__itownsCounterRotationWatch(250)`
  - `window.__itownsCounterRotationWatchStop()`
- Apply config manually: `window.__itownsApplyConfig(jsonObj)`

## Files Most Relevant Next Session
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/main.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/stencil-system.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/controls.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/modules/sources.js`
- `/Users/MadMax/Developer/Websites/iTowns/itowns-cityFab-XR/public/configs/default.json`

