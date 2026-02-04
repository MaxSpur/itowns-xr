import * as itowns from 'itowns';
import * as THREE from 'three';
import { applyObject3DTransform } from './object3d-utils.js';

export function setupGlobes(view, { orthoSource, elevationSource, transforms = {} } = {}) {
    const addLayer = itowns.View.prototype.addLayer.bind(view);

    // Context globe: default globe in the GlobeView
    view.addLayer(new itowns.ColorLayer('Ortho_context', { source: orthoSource }));
    view.addLayer(new itowns.ElevationLayer('MNT_WORLD_context', { source: elevationSource }));

    const contextRoot = view?.tileLayer?.object3d || view?.scene;
    if (contextRoot && transforms.context) {
        applyObject3DTransform(contextRoot, transforms.context);
    }

    const addChildGlobe = ({ globeId, orthoId, elevationId, diffuse = 0xd0d5d8 }) => {
        const object3D = new THREE.Object3D();
        object3D.updateMatrixWorld(true);

        const globe = new itowns.GlobeLayer(globeId, object3D);
        globe.diffuse = new THREE.Color(diffuse);
        addLayer(globe);
        addLayer(new itowns.ColorLayer(orthoId, { source: orthoSource }), globe);
        addLayer(new itowns.ElevationLayer(elevationId, { source: elevationSource }), globe);

        return object3D;
    };

    const originObject3D = addChildGlobe({
        globeId: 'origin_globe',
        orthoId: 'Ortho_origin',
        elevationId: 'MNT_WORLD_origin',
    });
    if (transforms.origin) applyObject3DTransform(originObject3D, transforms.origin);

    const destinationObject3D = addChildGlobe({
        globeId: 'destination_globe',
        orthoId: 'Ortho_destination',
        elevationId: 'MNT_WORLD_destination',
    });
    if (transforms.destination) applyObject3DTransform(destinationObject3D, transforms.destination);

    return { contextRoot, originObject3D, destinationObject3D };
}
