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

    zoomSurface.addEventListener('wheel', (event) => {
        event.preventDefault();
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords || !controls.handleZoom) return;
        controls.handleZoom({
            type: 'zoom',
            delta: event.deltaY,
            viewCoords,
        });
    }, { passive: false });

    zoomSurface.addEventListener('dblclick', (event) => {
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords || !controls.travel) return;
        controls.travel({
            viewCoords,
            direction: 'in',
        });
    });
}
