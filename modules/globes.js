import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupGlobes(view, { orthoSource, elevationSource }) {
    const addLayer = itowns.View.prototype.addLayer.bind(view);

    // Context globe: default globe in the GlobeView
    view.addLayer(new itowns.ColorLayer('Ortho_context', { source: orthoSource }));
    view.addLayer(new itowns.ElevationLayer('MNT_WORLD_context', { source: elevationSource }));

    const contextRoot = view?.tileLayer?.object3d || view?.scene;

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

    const destinationObject3D = addChildGlobe({
        globeId: 'destination_globe',
        orthoId: 'Ortho_destination',
        elevationId: 'MNT_WORLD_destination',
    });

    return { contextRoot, originObject3D, destinationObject3D };
}
