import * as itowns from 'itowns';
import { createSources } from './modules/sources.js';
import { setupGlobes } from './modules/globes.js';
import { setupStencilSystem } from './modules/stencil-system.js';
import { createMainView } from './modules/view-setup.js';

// ---------- SETUP THE VR VIEW ----------

const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 0.5,
    tilt: 80,
    heading: 0,
};

const viewerDiv = document.getElementById('viewerDiv');
const view = createMainView(viewerDiv, placement);
if (view.controls) {
    view.controls.minDistance = 0.1;
    // view.controls.handleCollision = false;
    // if (view.controls.setRange) view.controls.setRange(placement.range, false);
}


// ---------- SOURCES (shared) ----------

const { orthoSource, elevationSource } = createSources();

// ---------- GLOBES ----------

const { contextRoot, originObject3D, destinationObject3D } = setupGlobes(view, { orthoSource, elevationSource });

setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D });
