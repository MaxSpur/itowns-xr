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
    if (!controls || !view?.controls?.lookAtCoordinate) return;
    const coord = coordFromConfig(controls.targetGeo || controls.targetECEF);
    if (!coord) return;
    const range = controls.range ?? DEFAULT_PLACEMENT.range;
    const tilt = controls.tilt ?? DEFAULT_PLACEMENT.tilt;
    const heading = controls.heading ?? DEFAULT_PLACEMENT.heading;
    view.controls.lookAtCoordinate({ coord, range, tilt, heading }, false);
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
        applyViewControlsFromConfig(view, config);
        stencilSystem?.applyConfig?.(config);
    }
}

bootstrap();
