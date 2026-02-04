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
    view.controls.minDistance = 1;
    view.controls.handleCollision = false;
}


// ---------- SOURCES (shared) ----------

const { orthoSource, elevationSource } = createSources();

// ---------- GLOBES ----------

const { contextRoot, originObject3D, destinationObject3D } = setupGlobes(view, { orthoSource, elevationSource });

setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D });
