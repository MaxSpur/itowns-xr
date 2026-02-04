import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupGlobes(view, { orthoSource, elevationSource }) {
    // Context globe: default globe in the GlobeView
    view.addLayer(new itowns.ColorLayer('Ortho_context', { source: orthoSource }));
    view.addLayer(new itowns.ElevationLayer('MNT_WORLD_context', { source: elevationSource }));

    const contextRoot = view?.tileLayer?.object3d || view?.scene;

    // Origin globe
    const originObject3D = new THREE.Object3D();
    originObject3D.updateMatrixWorld(true);

    const originGlobe = new itowns.GlobeLayer('origin_globe', originObject3D);
    originGlobe.diffuse = new THREE.Color(0xd0d5d8);
    itowns.View.prototype.addLayer.call(view, originGlobe);
    itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_origin', { source: orthoSource }), originGlobe);
    itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_origin', { source: elevationSource }), originGlobe);

    // Destination globe
    const destinationObject3D = new THREE.Object3D();
    destinationObject3D.updateMatrixWorld(true);

    const destinationGlobe = new itowns.GlobeLayer('destination_globe', destinationObject3D);
    destinationGlobe.diffuse = new THREE.Color(0xd0d5d8);
    itowns.View.prototype.addLayer.call(view, destinationGlobe);
    itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_destination', { source: orthoSource }), destinationGlobe);
    itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_destination', { source: elevationSource }), destinationGlobe);

    return { contextRoot, originObject3D, destinationObject3D };
}
