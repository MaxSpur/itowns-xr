import * as itowns from 'itowns';
import { createSources } from './modules/sources.js';
import { loadAppConfig, resolveConfigUrl } from './modules/config.js';
import { setupGlobes } from './modules/globes.js';
import { setupStencilSystem } from './modules/stencil-system.js';
import { createMainView } from './modules/view-setup.js';
import { setupCustomZoomControls } from './modules/controls.js';

// ---------- SETUP THE VR VIEW ----------

const DEFAULT_PLACEMENT = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 15000,
    tilt: 20,
    heading: 0,
};

function coordFromConfig(coord) {
    if (!coord) return null;
    const crs = coord.crs || (coord.longitude !== undefined ? 'EPSG:4326' : 'EPSG:4978');
    if (crs === 'EPSG:4326') {
        const lon = coord.longitude ?? coord.lon ?? coord.x;
        const lat = coord.latitude ?? coord.lat ?? coord.y;
        const alt = coord.altitude ?? coord.alt ?? coord.z ?? 0;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        return new itowns.Coordinates('EPSG:4326', lon, lat, alt);
    }
    const x = coord.x;
    const y = coord.y;
    const z = coord.z;
    if (![x, y, z].every(Number.isFinite)) return null;
    return new itowns.Coordinates(crs, x, y, z);
}

function placementFromConfig(config) {
    const placement = config?.view?.placement;
    if (placement?.coord) {
        const coord = coordFromConfig(placement.coord);
        if (coord) {
            return {
                coord,
                range: placement.range ?? DEFAULT_PLACEMENT.range,
                tilt: placement.tilt ?? DEFAULT_PLACEMENT.tilt,
                heading: placement.heading ?? DEFAULT_PLACEMENT.heading,
            };
        }
    }
    const controls = config?.view?.controls;
    if (controls?.targetGeo || controls?.targetECEF) {
        const coord = coordFromConfig(controls.targetGeo || controls.targetECEF);
        if (coord) {
            return {
                coord,
                range: controls.range ?? DEFAULT_PLACEMENT.range,
                tilt: controls.tilt ?? DEFAULT_PLACEMENT.tilt,
                heading: controls.heading ?? DEFAULT_PLACEMENT.heading,
            };
        }
    }
    return DEFAULT_PLACEMENT;
}

function applyViewControlsFromConfig(view, config) {
    const controls = config?.view?.controls || config?.controls;
    if (!controls || !view?.controls?.lookAtCoordinate) return Promise.resolve(null);
    const coord = coordFromConfig(controls.targetGeo || controls.targetECEF);
    if (!coord) return Promise.resolve(null);
    const range = controls.range ?? DEFAULT_PLACEMENT.range;
    const tilt = controls.tilt ?? DEFAULT_PLACEMENT.tilt;
    const heading = controls.heading ?? DEFAULT_PLACEMENT.heading;
    return view.controls.lookAtCoordinate({ coord, range, tilt, heading }, false);
}

function stopCameraAutoGroundAdjust(view) {
    try {
        itowns.CameraUtils?.stop?.(view, view?.camera3D);
    } catch (e) {
        // no-op
    }
}

function enforceCameraFromConfig(view, config) {
    const cam = view?.camera3D;
    const cameraCfg = config?.view?.camera;
    const controlsCfg = config?.view?.controls || config?.controls;
    if (!cam || !cameraCfg?.position || !controlsCfg) return;

    const targetCoord = coordFromConfig(controlsCfg.targetECEF || controlsCfg.targetGeo);
    if (!targetCoord) return;
    const target = targetCoord.as(view.referenceCrs);

    cam.position.set(cameraCfg.position.x, cameraCfg.position.y, cameraCfg.position.z);
    cam.lookAt(target.x, target.y, target.z);
    if (Number.isFinite(cameraCfg.near)) cam.near = cameraCfg.near;
    if (Number.isFinite(cameraCfg.far)) cam.far = cameraCfg.far;
    if (Number.isFinite(cameraCfg.fov) && cam.isPerspectiveCamera) cam.fov = cameraCfg.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    view.notifyChange(cam);
}

function angleDeltaDeg(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
}

function isViewRestored(view, config) {
    const controlsCfg = config?.view?.controls || config?.controls;
    if (!controlsCfg || !view?.controls || !view?.camera3D) return false;

    const range = view.controls.getRange?.();
    const tilt = view.controls.getTilt?.();
    const heading = view.controls.getHeading?.();
    const rangeOk = Number.isFinite(range) && Number.isFinite(controlsCfg.range) && Math.abs(range - controlsCfg.range) < 0.5;
    const tiltOk = Number.isFinite(tilt) && Number.isFinite(controlsCfg.tilt) && Math.abs(tilt - controlsCfg.tilt) < 0.2;
    const headingOk = Number.isFinite(heading) && Number.isFinite(controlsCfg.heading) && angleDeltaDeg(heading, controlsCfg.heading) < 0.3;

    const cameraCfg = config?.view?.camera?.position;
    const cam = view.camera3D.position;
    const cameraOk = cameraCfg
        ? (Math.abs(cam.x - cameraCfg.x) < 0.5 && Math.abs(cam.y - cameraCfg.y) < 0.5 && Math.abs(cam.z - cameraCfg.z) < 0.5)
        : true;

    return rangeOk && tiltOk && headingOk && cameraOk;
}

function restoreViewFromConfigStabilized(view, config, {
    durationMs = 12000,
    intervalMs = 500,
} = {}) {
    if (!config || !view) return () => {};
    const started = performance.now();
    let stopped = false;
    let timer = null;

    const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        for (const [name, handler] of listeners) {
            window.removeEventListener(name, handler, true);
        }
    };

    const attempt = () => {
        if (stopped) return;
        applyViewControlsFromConfig(view, config)
            .finally(() => {
                stopCameraAutoGroundAdjust(view);
                enforceCameraFromConfig(view, config);
            });

        const elapsed = performance.now() - started;
        if (isViewRestored(view, config) || elapsed >= durationMs) {
            cleanup();
        }
    };

    const stopOnUserInput = () => cleanup();
    const listeners = [
        ['wheel', stopOnUserInput],
        ['pointerdown', stopOnUserInput],
        ['keydown', stopOnUserInput],
    ];
    for (const [name, handler] of listeners) {
        window.addEventListener(name, handler, { capture: true, passive: true });
    }

    attempt();
    requestAnimationFrame(attempt);
    setTimeout(attempt, 0);
    setTimeout(attempt, 1000);
    setTimeout(attempt, 3000);
    timer = setInterval(attempt, intervalMs);

    return cleanup;
}

async function bootstrap() {
    const configUrl = resolveConfigUrl();
    const config = await loadAppConfig({ url: configUrl, silent: true });

    const viewerDiv = document.getElementById('viewerDiv');
    const view = createMainView(viewerDiv, placementFromConfig(config));
    setupCustomZoomControls({ view, viewerDiv });


// ---------- SOURCES (shared) ----------

    const { orthoSource, elevationSource, sourceOptions } = createSources(config?.sources);

// ---------- GLOBES ----------

    const globeTransforms = config?.globes?.transforms || {
        // Example XR placement:
        // origin: { position: [0, 0, 0], scale: 0.001 },
        // destination: { position: [0.4, 0, 0], scale: 0.001 },
        // context: { position: [-0.4, 0, 0], scale: 0.001 },
    };

    const { contextRoot, originObject3D, destinationObject3D } = setupGlobes(view, {
        orthoSource,
        elevationSource,
        transforms: globeTransforms,
    });

    view.userData = view.userData || {};
    view.userData.configUrl = configUrl;
    view.userData.sources = sourceOptions;
    view.userData.globeTransforms = globeTransforms;

    const stencilSystem = setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D });
    if (config) {
        let stopRestore = restoreViewFromConfigStabilized(view, config);
        stencilSystem?.applyConfig?.(config);

        const onInitialized = () => {
            stopRestore?.();
            stopRestore = restoreViewFromConfigStabilized(view, config);
            view.removeEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, onInitialized);
        };
        view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, onInitialized);
    }
}

bootstrap();
