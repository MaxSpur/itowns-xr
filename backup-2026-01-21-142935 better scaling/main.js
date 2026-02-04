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
    view.controls.zoomFactor = 1.02;
    view.controls.enableDamping = true;
    view.controls.dampingMoveFactor = 0.12;
    view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, () => {
        const tiltDeg = view.controls.getTilt?.() ?? placement.tilt ?? 80;
        const tiltRad = tiltDeg * Math.PI / 180;
        view.controls.minPolarAngle = tiltRad;
        view.controls.maxPolarAngle = tiltRad;
    });
}


// ---------- SOURCES (shared) ----------

const { orthoSource, elevationSource } = createSources();

// ---------- GLOBES ----------

const { contextRoot, originObject3D, destinationObject3D } = setupGlobes(view, { orthoSource, elevationSource });

setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D });
