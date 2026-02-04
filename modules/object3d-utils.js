import * as THREE from 'three';

const isFiniteNumber = (value) => Number.isFinite(value);

const toVector3 = (value, fallback = new THREE.Vector3()) => {
    if (!value) return fallback;
    if (value.isVector3) return value;
    if (Array.isArray(value)) {
        const [x = fallback.x, y = fallback.y, z = fallback.z] = value;
        return new THREE.Vector3(x, y, z);
    }
    if (typeof value === 'object') {
        const { x = fallback.x, y = fallback.y, z = fallback.z } = value;
        return new THREE.Vector3(x, y, z);
    }
    return fallback;
};

const toQuaternion = (value, fallback = new THREE.Quaternion()) => {
    if (!value) return fallback;
    if (value.isQuaternion) return value;
    if (Array.isArray(value)) {
        const [x = fallback.x, y = fallback.y, z = fallback.z, w = fallback.w] = value;
        return new THREE.Quaternion(x, y, z, w);
    }
    if (typeof value === 'object') {
        const { x = fallback.x, y = fallback.y, z = fallback.z, w = fallback.w } = value;
        return new THREE.Quaternion(x, y, z, w);
    }
    return fallback;
};

const toEuler = (value, fallback = new THREE.Euler()) => {
    if (!value) return fallback;
    if (value.isEuler) return value;
    if (Array.isArray(value)) {
        const [x = fallback.x, y = fallback.y, z = fallback.z] = value;
        return new THREE.Euler(x, y, z);
    }
    if (typeof value === 'object') {
        const { x = fallback.x, y = fallback.y, z = fallback.z } = value;
        return new THREE.Euler(x, y, z);
    }
    return fallback;
};

export function applyObject3DTransform(object3D, transform = {}) {
    if (!object3D || !transform) return;

    const { position, scale, rotation, quaternion, visible } = transform;

    if (position) {
        const pos = toVector3(position, object3D.position);
        object3D.position.copy(pos);
    }

    if (scale !== undefined && scale !== null) {
        if (typeof scale === 'number' && isFiniteNumber(scale)) {
            object3D.scale.setScalar(scale);
        } else {
            const vec = toVector3(scale, object3D.scale);
            object3D.scale.copy(vec);
        }
    }

    if (rotation) {
        const euler = toEuler(rotation, object3D.rotation);
        object3D.rotation.copy(euler);
    }

    if (quaternion) {
        const quat = toQuaternion(quaternion, object3D.quaternion);
        object3D.quaternion.copy(quat);
    }

    if (typeof visible === 'boolean') {
        object3D.visible = visible;
    }

    object3D.updateMatrixWorld(true);
}

export function rotateAroundPoint(object3D, point, axis, angle) {
    if (!object3D || !point || !axis) return;
    if (axis.lengthSq() < 1e-8 || Math.abs(angle) < 1e-8) return;
    const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
    object3D.position.sub(point);
    object3D.position.applyQuaternion(q);
    object3D.position.add(point);
    object3D.quaternion.premultiply(q);
    object3D.updateMatrixWorld(true);
}

export function scaleAroundPoint(object3D, point, factor) {
    if (!object3D || !point || !isFiniteNumber(factor)) return;
    if (Math.abs(factor - 1) < 1e-6) return;
    object3D.position.sub(point);
    object3D.position.multiplyScalar(factor);
    object3D.position.add(point);
    object3D.scale.multiplyScalar(factor);
    object3D.updateMatrixWorld(true);
}
