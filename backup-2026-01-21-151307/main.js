import * as itowns from 'itowns';
import { createSources } from './modules/sources.js';
import { setupGlobes } from './modules/globes.js';
import { setupStencilSystem } from './modules/stencil-system.js';
import { createMainView } from './modules/view-setup.js';

// ---------- SETUP THE VR VIEW ----------

const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 15000,
    tilt: 20,
    heading: 0,
};

const viewerDiv = document.getElementById('viewerDiv');
const view = createMainView(viewerDiv, placement);
if (view.controls) {
    view.controls.zoomFactor = 1.01;
    view.controls.enableDamping = true;
    view.controls.dampingMoveFactor = 0.12;
    view.controls.minDistance = 0.5;
    view.controls.handleCollision = false;
    if (view.controls.states?.setFromOptions) {
        view.controls.states.setFromOptions({ ZOOM: { enable: false } });
    }
}
if (view.controls?.setRange) {
    viewerDiv.addEventListener('wheel', (event) => {
        event.preventDefault();
        const range = view.controls.getRange();
        const step = 0.0015;
        const factor = Math.exp(Math.abs(event.deltaY) * step);
        let next = event.deltaY > 0 ? range * factor : range / factor;
        const min = view.controls.minDistance ?? 0;
        const max = view.controls.maxDistance ?? Infinity;
        next = Math.max(min, Math.min(max, next));
        view.controls.setRange(next, false);
    }, { passive: false });
}


// ---------- SOURCES (shared) ----------

const { orthoSource, elevationSource } = createSources();

// ---------- GLOBES ----------

const { contextRoot, originObject3D, destinationObject3D } = setupGlobes(view, { orthoSource, elevationSource });

setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D });
