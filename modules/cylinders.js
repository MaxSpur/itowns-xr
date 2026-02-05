import * as THREE from 'three';

export function createStencilUniforms(initialRadiusMeters) {
    return {
        uStencilCenter: { value: new THREE.Vector3() }, // world / EPSG:4978
        uStencilAxis: { value: new THREE.Vector3(0, 1, 0) }, // unit
        uStencilRadius: { value: initialRadiusMeters }, // meters (world)
        uStencilEnabled: { value: 1.0 }, // 0 = disabled, 1 = enabled
        uStencilDiscardOutside: { value: 1.0 }, // 0 = blend-to-diffuse outside, 1 = discard outside
    };
}

const MIN_STENCIL_RADIUS = 0.01;

export function makeStencilCylinder(view, uniforms, {
    radius = 1500,
    opacity = 0.35,
    color = 0xff0000,
} = {}) {
    const geom = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'StencilCylinder';
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    view.scene.add(mesh);

    const state = {
        center: new THREE.Vector3(),
        radius,
        height: Math.max(1, radius * 0.5),
    };

    function updateFromState() {
        const axis = state.center.lengthSq() > 0 ? state.center.clone().normalize() : new THREE.Vector3(0, 1, 0);

        state.height = Math.max(1, state.radius * 0.5);

        uniforms.uStencilCenter.value.copy(state.center);
        uniforms.uStencilAxis.value.copy(axis);
        uniforms.uStencilRadius.value = state.radius;

        const up = new THREE.Vector3(0, 1, 0);
        mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, axis));
        mesh.scale.set(state.radius, state.height, state.radius);
        mesh.position.copy(state.center); // centered => extends equally up & down
        mesh.updateMatrixWorld(true);

        view.notifyChange(true);
    }

    return {
        mesh,
        setCenterECEF(v) {
            state.center.copy(v);
            updateFromState();
        },
        setRadiusMeters(r) {
            state.radius = Math.max(MIN_STENCIL_RADIUS, +r || MIN_STENCIL_RADIUS);
            updateFromState();
        },
        setOpacity(a) {
            mesh.material.opacity = THREE.MathUtils.clamp(+a || 0, 0, 1);
            view.notifyChange(true);
        },
        update: updateFromState,
    };
}

export function makeGhostCylinder(view, {
    radius = 1500,
    opacity = 0.35,
    color = 0xff0000,
} = {}) {
    const geom = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'GhostCylinder';
    mesh.frustumCulled = false;
    mesh.renderOrder = 51;
    mesh.visible = false;
    view.scene.add(mesh);

    const state = {
        center: new THREE.Vector3(),
        radius,
        height: Math.max(1, radius * 0.5),
    };

    function updateFromState() {
        const axis = state.center.lengthSq() > 0 ? state.center.clone().normalize() : new THREE.Vector3(0, 1, 0);
        state.height = Math.max(1, state.radius * 0.5);
        const up = new THREE.Vector3(0, 1, 0);
        mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, axis));
        mesh.scale.set(state.radius, state.height, state.radius);
        mesh.position.copy(state.center);
        mesh.updateMatrixWorld(true);
        view.notifyChange(true);
    }

    return {
        mesh,
        setCenterECEF(v) {
            state.center.copy(v);
            updateFromState();
        },
        setRadiusMeters(r) {
            state.radius = Math.max(MIN_STENCIL_RADIUS, +r || MIN_STENCIL_RADIUS);
            updateFromState();
        },
        setOpacity(a) {
            mesh.material.opacity = THREE.MathUtils.clamp(+a || 0, 0, 1);
            view.notifyChange(true);
        },
        update: updateFromState,
    };
}
