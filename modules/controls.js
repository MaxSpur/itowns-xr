import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupCustomZoomControls({ view, viewerDiv }) {
    if (!view?.controls) return;

    const controls = view.controls;

    controls.zoomFactor = 1.01;
    controls.enableDamping = true;
    controls.dampingMoveFactor = 0.12;
    controls.minDistance = 0.1;
    controls.handleCollision = false;
    if (controls.states?.setFromOptions) {
        controls.states.setFromOptions({
            ZOOM: { enable: false },
            TRAVEL_IN: { enable: false },
        });
    }

    if (!controls.lookAtCoordinate) return;

    const zoomSurface = view.mainLoop?.gfxEngine?.renderer?.domElement
        || view.domElement
        || viewerDiv;
    if (!zoomSurface?.addEventListener) return;

    const getScaledViewCoords = (event) => {
        const rect = zoomSurface.getBoundingClientRect?.();
        if (!rect) return null;
        let viewCoords = view.eventToViewCoords?.(event);
        if (!viewCoords) {
            viewCoords = new THREE.Vector2(
                event.clientX - rect.x,
                event.clientY - rect.y,
            );
        }
        const dim = view.mainLoop?.gfxEngine?.getWindowSize?.();
        const scaleX = dim?.x ? dim.x / rect.width : 1;
        const scaleY = dim?.y ? dim.y / rect.height : 1;
        if (scaleX === 1 && scaleY === 1) return viewCoords;
        return viewCoords.clone().set(viewCoords.x * scaleX, viewCoords.y * scaleY);
    };

    const orientationLock = {
        tilt: Number.isFinite(controls.getTilt?.()) ? controls.getTilt() : undefined,
        heading: Number.isFinite(controls.getHeading?.()) ? controls.getHeading() : undefined,
    };

    const zoomNoTilt = (delta) => {
        const cam = view?.camera3D;
        const target = controls.getCameraTargetPosition?.();
        if (!cam || !target || !Number.isFinite(delta)) return;

        controls.player?.stop?.();
        itowns.CameraUtils?.stop?.(view, cam);

        const zoomFactor = controls.zoomFactor || 1.05;
        // scale with delta magnitude to keep trackpads responsive
        const zoomScale = Math.pow(zoomFactor, delta * 0.003);

        const currentRange = cam.position.distanceTo(target);
        if (!Number.isFinite(currentRange)) return;
        const minDistance = Number.isFinite(controls.minDistance) ? controls.minDistance : 0;
        const maxDistance = Number.isFinite(controls.maxDistance) ? controls.maxDistance : Infinity;
        const nextRange = THREE.MathUtils.clamp(currentRange * zoomScale, minDistance, maxDistance);
        if (Math.abs(nextRange - currentRange) < 1e-6) return;

        const dir = cam.position.clone().sub(target);
        if (dir.lengthSq() < 1e-8) return;
        dir.normalize();
        cam.position.copy(target).add(dir.multiplyScalar(nextRange));
        cam.updateMatrixWorld(true);
        view.notifyChange(cam);
    };

    // Hard override any internal zoom handler to avoid tilt changes.
    controls.handleZoom = (event) => {
        if (event?.delta == null) return;
        zoomNoTilt(event.delta);
    };
    // Replace the bound zoom listener so the original handler can't run.
    if (controls.states?.removeEventListener && controls.states?.addEventListener) {
        if (controls._onZoom) {
            controls.states.removeEventListener('zoom', controls._onZoom, false);
        }
        controls._onZoom = (event) => {
            if (event?.delta == null) return;
            zoomNoTilt(event.delta);
        };
        controls.states.addEventListener('zoom', controls._onZoom, false);
    }

    zoomSurface.addEventListener('wheel', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords) return;
        zoomNoTilt(event.deltaY);
    }, { passive: false });

    if (controls.addEventListener && itowns?.CONTROL_EVENTS?.ORIENTATION_CHANGED) {
        controls.addEventListener(itowns.CONTROL_EVENTS.ORIENTATION_CHANGED, (event) => {
            if (event?.new?.tilt !== undefined) orientationLock.tilt = event.new.tilt;
            if (event?.new?.heading !== undefined) orientationLock.heading = event.new.heading;
        });
    }

    // Override travel to keep tilt/heading stable.
    controls.travel = (event) => {
        const point = view.getPickingPositionFromDepth?.(event.viewCoords);
        const range = controls.getRange?.(point);
        if (!point || !Number.isFinite(range) || range <= controls.minDistance) return;
        const coord = new itowns.Coordinates('EPSG:4978').setFromVector3(point);
        const tilt = Number.isFinite(orientationLock.tilt) ? orientationLock.tilt : controls.getTilt?.();
        const heading = Number.isFinite(orientationLock.heading) ? orientationLock.heading : controls.getHeading?.();
        return controls.lookAtCoordinate({
            coord,
            range: range * (event.direction === 'out' ? 1 / 0.6 : 0.6),
            tilt,
            heading,
        }, false);
    };

    setupZoomDebugLogging({ view, controls, zoomSurface });

    zoomSurface.addEventListener('dblclick', (event) => {
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords || !controls.travel) return;
        controls.travel({
            viewCoords,
            direction: 'in',
        });
    });
}

function setupZoomDebugLogging({ view, controls, zoomSurface }) {
    if (!view || !controls || !zoomSurface) return;

    const state = {
        enabled: false,
        maxEntries: 800,
        entries: [],
        sampleTimer: null,
        sampleMs: 0,
    };

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const last = {
        coord: null,
        range: Number.isFinite(controls.getRange?.()) ? controls.getRange() : null,
        tilt: Number.isFinite(controls.getTilt?.()) ? controls.getTilt() : null,
        heading: Number.isFinite(controls.getHeading?.()) ? controls.getHeading() : null,
    };

    const readSnapshot = () => {
        const camPos = view.camera3D?.position;
        return {
            coord: last.coord,
            range: last.range,
            tilt: last.tilt,
            heading: last.heading,
            camPos: camPos ? { x: camPos.x, y: camPos.y, z: camPos.z } : null,
        };
    };

    const push = (type, extra = {}) => {
        if (!state.enabled) return;
        const entry = { t: now(), type, ...readSnapshot(), ...extra };
        state.entries.push(entry);
        if (state.entries.length > state.maxEntries) {
            state.entries.splice(0, state.entries.length - state.maxEntries);
        }
    };

    const startSampling = () => {
        if (!state.sampleMs || state.sampleMs <= 0) return;
        if (state.sampleTimer) clearInterval(state.sampleTimer);
        state.sampleTimer = setInterval(() => push('sample'), state.sampleMs);
    };

    const stopSampling = () => {
        if (state.sampleTimer) {
            clearInterval(state.sampleTimer);
            state.sampleTimer = null;
        }
    };

    const onWheel = (event) => {
        push('wheel', { delta: event.deltaY });
    };

    zoomSurface.addEventListener('wheel', onWheel, { passive: true });

    const onCameraMoved = () => push('camera-moved');
    const onOrientation = (event) => {
        if (event?.new?.tilt !== undefined) last.tilt = event.new.tilt;
        if (event?.new?.heading !== undefined) last.heading = event.new.heading;
        push('orientation-changed');
    };
    const onRange = (event) => {
        if (event?.new !== undefined) last.range = event.new;
        push('range-changed');
    };
    const onTarget = (event) => {
        const coord = event?.new;
        if (coord) {
            last.coord = {
                crs: coord.crs,
                longitude: coord.longitude,
                latitude: coord.latitude,
                altitude: coord.altitude,
            };
        }
        push('target-changed');
    };

    if (view.addEventListener && itowns?.VIEW_EVENTS?.CAMERA_MOVED) {
        view.addEventListener(itowns.VIEW_EVENTS.CAMERA_MOVED, onCameraMoved);
    }
    if (controls.addEventListener && itowns?.CONTROL_EVENTS) {
        controls.addEventListener(itowns.CONTROL_EVENTS.ORIENTATION_CHANGED, onOrientation);
        controls.addEventListener(itowns.CONTROL_EVENTS.RANGE_CHANGED, onRange);
        controls.addEventListener(itowns.CONTROL_EVENTS.CAMERA_TARGET_CHANGED, onTarget);
    }

    const api = {
        start(options = {}) {
            state.enabled = true;
            if (Number.isFinite(options.maxEntries)) state.maxEntries = options.maxEntries;
            state.sampleMs = Number.isFinite(options.sampleMs) ? options.sampleMs : state.sampleMs;
            if (!last.coord && controls.getLookAtCoordinate) {
                const coord = controls.getLookAtCoordinate();
                if (coord) {
                    last.coord = {
                        crs: coord.crs,
                        longitude: coord.longitude,
                        latitude: coord.latitude,
                        altitude: coord.altitude,
                    };
                }
            }
            push('start');
            startSampling();
        },
        stop() {
            push('stop');
            state.enabled = false;
            stopSampling();
        },
        clear() {
            state.entries = [];
        },
        dump() {
            return [...state.entries];
        },
        print() {
            console.table(state.entries.map(e => ({
                t: Math.round(e.t),
                type: e.type,
                range: e.range,
                tilt: e.tilt,
                heading: e.heading,
                lat: e.coord?.latitude,
                lon: e.coord?.longitude,
                alt: e.coord?.altitude,
            })));
        },
    };

    if (typeof window !== 'undefined') {
        window.__itownsZoomLog = api;
    }
}
