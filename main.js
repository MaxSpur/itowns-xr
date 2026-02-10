import * as itowns from 'itowns';
import * as THREE from 'three';
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

const STARTUP_TILT_MIN = 4;
const STARTUP_TILT_MAX = 89.5;

function sanitizeStartupTilt(tilt) {
    if (!Number.isFinite(tilt)) return DEFAULT_PLACEMENT.tilt;
    return Math.min(STARTUP_TILT_MAX, Math.max(STARTUP_TILT_MIN, tilt));
}

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
                // GlobeView constructor applies this before our controls patching.
                // Keep startup tilt inside the default GlobeControls interval.
                tilt: sanitizeStartupTilt(placement.tilt),
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
                tilt: sanitizeStartupTilt(controls.tilt),
                heading: controls.heading ?? DEFAULT_PLACEMENT.heading,
            };
        }
    }
    return DEFAULT_PLACEMENT;
}

function stopCameraAutoGroundAdjust(view) {
    try {
        itowns.CameraUtils?.stop?.(view, view?.camera3D);
    } catch (e) {
        // no-op
    }
}

function getControlTargetFromConfig(view, config) {
    const controlsCfg = config?.view?.controls || config?.controls;
    const targetCoord = coordFromConfig(controlsCfg?.targetECEF || controlsCfg?.targetGeo);
    if (!targetCoord) return null;
    const target = targetCoord.as(view.referenceCrs);
    if (![target.x, target.y, target.z].every(Number.isFinite)) return null;
    return new THREE.Vector3(target.x, target.y, target.z);
}

function enforceCameraFromConfig(view, config) {
    const cam = view?.camera3D;
    const cameraCfg = config?.view?.camera;
    if (!cam || !cameraCfg?.position) return;

    const target = getControlTargetFromConfig(view, config);

    cam.position.set(cameraCfg.position.x, cameraCfg.position.y, cameraCfg.position.z);
    if (cameraCfg.quaternion && Number.isFinite(cameraCfg.quaternion.x) && Number.isFinite(cameraCfg.quaternion.y)
        && Number.isFinite(cameraCfg.quaternion.z) && Number.isFinite(cameraCfg.quaternion.w)) {
        cam.quaternion.set(cameraCfg.quaternion.x, cameraCfg.quaternion.y, cameraCfg.quaternion.z, cameraCfg.quaternion.w);
    } else if (target) {
        cam.lookAt(target.x, target.y, target.z);
    }
    const targetPos = view?.controls?.getCameraTargetPosition?.();
    if (targetPos?.copy && target) {
        targetPos.copy(target);
    }
    if (Number.isFinite(cameraCfg.near)) cam.near = cameraCfg.near;
    if (Number.isFinite(cameraCfg.far)) cam.far = cameraCfg.far;
    if (Number.isFinite(cameraCfg.fov) && cam.isPerspectiveCamera) cam.fov = cameraCfg.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    view.notifyChange(cam);
}

async function primeControlsFromConfig(view, config) {
    const controls = view?.controls;
    if (!controls?.lookAtCoordinate) return;
    const controlsCfg = config?.view?.controls || config?.controls;
    if (!controlsCfg) return;
    const coord = coordFromConfig(controlsCfg.targetECEF || controlsCfg.targetGeo);
    if (!coord) return;

    const params = {
        coord,
        range: controlsCfg.range ?? DEFAULT_PLACEMENT.range,
        tilt: controlsCfg.tilt ?? DEFAULT_PLACEMENT.tilt,
        heading: controlsCfg.heading ?? DEFAULT_PLACEMENT.heading,
        proxy: false,
    };
    try {
        await controls.lookAtCoordinate(params, false);
    } catch (e) {
        // best effort: we enforce exact camera pose right after this call
    }
    stopCameraAutoGroundAdjust(view);
    enforceCameraFromConfig(view, config);
}

function isViewRestored(view, config) {
    if (!view?.camera3D) return false;
    const cameraCfg = config?.view?.camera;
    const cam = view.camera3D.position;
    const cameraPosOk = cameraCfg?.position
        ? (Math.abs(cam.x - cameraCfg.position.x) < 0.5 && Math.abs(cam.y - cameraCfg.position.y) < 0.5 && Math.abs(cam.z - cameraCfg.position.z) < 0.5)
        : true;
    const q = view.camera3D.quaternion;
    const cameraQuatOk = cameraCfg?.quaternion
        ? (Math.abs(q.x - cameraCfg.quaternion.x) < 1e-4
            && Math.abs(q.y - cameraCfg.quaternion.y) < 1e-4
            && Math.abs(q.z - cameraCfg.quaternion.z) < 1e-4
            && Math.abs(q.w - cameraCfg.quaternion.w) < 1e-4)
        : true;
    const targetPos = view?.controls?.getCameraTargetPosition?.();
    const expectedTarget = getControlTargetFromConfig(view, config);
    const targetOk = expectedTarget && targetPos
        ? (Math.abs(targetPos.x - expectedTarget.x) < 0.5
            && Math.abs(targetPos.y - expectedTarget.y) < 0.5
            && Math.abs(targetPos.z - expectedTarget.z) < 0.5)
        : true;

    return cameraPosOk && cameraQuatOk && targetOk;
}

function restoreViewFromConfigStabilized(view, config, {
    durationMs = 20000,
    intervalMs = 300,
    onAbort = null,
} = {}) {
    if (!config || !view) {
        return {
            stop: () => {},
            wasAborted: () => false,
        };
    }
    const started = performance.now();
    let stopped = false;
    let timer = null;
    let abortedByUser = false;

    const cleanup = (reason = 'done') => {
        if (stopped) return;
        stopped = true;
        if (reason === 'user') {
            abortedByUser = true;
            onAbort?.(reason);
        }
        if (timer) clearInterval(timer);
        for (const [name, handler] of listeners) {
            window.removeEventListener(name, handler, true);
        }
    };

    const attempt = () => {
        if (stopped) return;
        stopCameraAutoGroundAdjust(view);
        enforceCameraFromConfig(view, config);

        const elapsed = performance.now() - started;
        if (isViewRestored(view, config) || elapsed >= durationMs) {
            cleanup('done');
        }
    };

    const stopOnUserInput = () => cleanup('user');
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
    timer = setInterval(attempt, intervalMs);

    return {
        stop: () => cleanup('stopped'),
        wasAborted: () => abortedByUser,
    };
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
        let userInteractedSinceLoad = false;
        const markUserInteraction = () => { userInteractedSinceLoad = true; };
        const interactionListeners = [
            ['wheel', markUserInteraction],
            ['pointerdown', markUserInteraction],
            ['keydown', markUserInteraction],
        ];
        for (const [name, handler] of interactionListeners) {
            window.addEventListener(name, handler, { capture: true, passive: true });
        }

        let restoreCtl = restoreViewFromConfigStabilized(view, config, {
            onAbort: () => { userInteractedSinceLoad = true; },
        });
        stencilSystem?.applyConfig?.(config);

        const onInitialized = () => {
            restoreCtl?.stop?.();
            if (!userInteractedSinceLoad) {
                restoreCtl = restoreViewFromConfigStabilized(view, config, {
                    onAbort: () => { userInteractedSinceLoad = true; },
                });
                setTimeout(() => {
                    if (userInteractedSinceLoad) return;
                    primeControlsFromConfig(view, config);
                }, 1200);
            }
            for (const [name, handler] of interactionListeners) {
                window.removeEventListener(name, handler, true);
            }
            view.removeEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, onInitialized);
        };
        view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, onInitialized);
    }
}

bootstrap();
