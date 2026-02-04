import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupGlobes(view, { orthoSource, elevationSource }) {
    // Globe 1: default globe in the GlobeView
    view.addLayer(new itowns.ColorLayer('Ortho_globe1', { source: orthoSource }));
    view.addLayer(new itowns.ElevationLayer('MNT_WORLD_globe1', { source: elevationSource }));

    // Globe 2: additional GlobeLayer
    const globe2Object3D = new THREE.Object3D();
    // globe2Object3D.scale.divideScalar(3);
    // globe2Object3D.position.y = 10_000_000;
    globe2Object3D.updateMatrixWorld(true);

    const globe2 = new itowns.GlobeLayer('globe2', globe2Object3D);
    globe2.diffuse = new THREE.Color(0xd0d5d8);
    itowns.View.prototype.addLayer.call(view, globe2);
    itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_globe2', { source: orthoSource }), globe2);
    itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_globe2', { source: elevationSource }), globe2);

    // Globe 3: additional GlobeLayer
    const globe3Object3D = new THREE.Object3D();
    globe3Object3D.updateMatrixWorld(true);

    const globe3 = new itowns.GlobeLayer('globe3', globe3Object3D);
    globe3.diffuse = new THREE.Color(0xd0d5d8);
    itowns.View.prototype.addLayer.call(view, globe3);
    itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_globe3', { source: orthoSource }), globe3);
    itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_globe3', { source: elevationSource }), globe3);

    return { globe2Object3D, globe3Object3D, globe2, globe3 };
}
