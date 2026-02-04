import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupCustomZoomControls({ view, viewerDiv }) {
    if (!view?.controls) return;

    view.controls.zoomFactor = 1.01;
    view.controls.enableDamping = true;
    view.controls.dampingMoveFactor = 0.12;
    view.controls.minDistance = 0.1;
    view.controls.handleCollision = false;
    if (view.controls.states?.setFromOptions) {
        view.controls.states.setFromOptions({
            ZOOM: { enable: false },
            TRAVEL_IN: { enable: false },
        });
    }

    if (!view.controls.lookAtCoordinate) return;

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
        viewCoords = viewCoords.clone();
        viewCoords.set(viewCoords.x * scaleX, viewCoords.y * scaleY);
        return viewCoords;
    };

    zoomSurface.addEventListener('wheel', (event) => {
        event.preventDefault();
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords || !view.controls?.handleZoom) return;
        view.controls.handleZoom({
            type: 'zoom',
            delta: event.deltaY,
            viewCoords,
        });
    }, { passive: false });

    zoomSurface.addEventListener('dblclick', (event) => {
        const viewCoords = getScaledViewCoords(event);
        if (!viewCoords || !view.controls?.travel) return;
        view.controls.travel({
            viewCoords,
            direction: 'in',
        });
    });
}
