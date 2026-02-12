import * as itowns from 'itowns';
import * as THREE from 'three';
import { createStencilUniforms, makeGhostCylinder, makeStencilCylinder } from './cylinders.js';
import { patchMeshesUnderRoot, logMaterialsForRoot } from './patching.js';
import { createStencilWidget, radiusFromSlider01, slider01FromRadius, formatMeters } from './ui.js';
import { applyObject3DTransform, rotateAroundPoint, scaleAroundPoint } from './object3d-utils.js';
import { attachContextControls, attachScaleControls, attachDumpControls, attachSavedViewsControls } from './stencil-ui-extensions.js';

export function setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D }) {
    const contextObject3D = contextRoot || view?.tileLayer?.object3d || view?.scene;
    let originScale = originObject3D?.scale?.x || 1;
    let destinationScale = destinationObject3D?.scale?.x || 1;
    let contextScale = contextObject3D?.scale?.x || 1;
    const pickRaycaster = new THREE.Raycaster();
    const pickNdc = new THREE.Vector2();
    const pickEllipsoid = new itowns.Ellipsoid();
    const baseEllipsoidSize = pickEllipsoid.size.clone();
    const originLayer = view.getLayerById?.('origin_globe');
    const destinationLayer = view.getLayerById?.('destination_globe');
    const contextLayer = view.tileLayer;
    // Build three independent stencils (UI + cylinder + patching + picking)
    const stencil1 = {
        id: 'g1',
        title: 'Origin',
        panelPos: { left: '10px', top: '10px' },
        color: 0x2f8bff,
        uniforms: createStencilUniforms(1500.0 * originScale),
        patchRoot: () => originObject3D || view?.tileLayer?.object3d || view?.scene, // fallback
        state: { patched: new WeakSet(), count: 0 },
        picking: false,
        rotating: false,
    };
    const stencil2 = {
        id: 'g2',
        title: 'Destination',
        panelPos: { right: '10px', top: '10px' },
        color: 0xff3344,
        uniforms: createStencilUniforms(1500.0 * destinationScale),
        patchRoot: () => destinationObject3D,
        state: { patched: new WeakSet(), count: 0 },
        picking: false,
        rotating: false,
    };
    const stencil3 = {
        id: 'g3',
        title: 'Context',
        panelPos: { left: '50%', top: '10px', transform: 'translateX(-50%)' },
        color: 0x2ecc71,
        uniforms: createStencilUniforms(1500.0 * contextScale),
        patchRoot: () => contextObject3D,
        state: { patched: new WeakSet(), count: 0 },
        picking: false,
    };

    stencil1.cylinder = makeStencilCylinder(view, stencil1.uniforms, { radius: stencil1.uniforms.uStencilRadius.value, color: stencil1.color, opacity: 0.35 });
    stencil2.cylinder = makeStencilCylinder(view, stencil2.uniforms, { radius: stencil2.uniforms.uStencilRadius.value, color: stencil2.color, opacity: 0.35 });
    stencil3.cylinder = makeStencilCylinder(view, stencil3.uniforms, { radius: stencil3.uniforms.uStencilRadius.value, color: stencil3.color, opacity: 0.35 });

    const identityQuat = new THREE.Quaternion();
    const tempQuat = new THREE.Quaternion();
    const ghostBlue = makeGhostCylinder(view, { radius: stencil1.uniforms.uStencilRadius.value, color: stencil1.color, opacity: 0.35 });
    const ghostRed = makeGhostCylinder(view, { radius: stencil2.uniforms.uStencilRadius.value, color: stencil2.color, opacity: 0.35 });
    let updateContextButton = () => {};
    const contextModePrev = { active: false, owner: null };
    const counterRotationState = { angleRad: 0 };
    const globeScaleState = { value: 1 };
    const verticalAlignState = { auto: true, method: 'radial' };
    const cylinderAlignState = { auto: true, target: 'context' };
    const axisTmp = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const axisQuat = new THREE.Quaternion();
    const contextPosTmp = new THREE.Vector3();
    const contextScaleTmp = new THREE.Vector3();
    const contextQuatTmp = new THREE.Quaternion();
    const contextInvQuatTmp = new THREE.Quaternion();
    const contextModeState = {
        enabled: false,
        globe1Visible: true,
        globe2Visible: true,
        cyl1Visible: true,
        cyl2Visible: true,
        stencil3Enabled: true,
    };
    let isGlobeInitialized = false;
    let didInitialize = false;
    let pendingConfig = null;
    let suppressAutoAlignment = false;
    let scaleUi = null;
    let savedViewsUi = null;
    const SAVED_TARGET_VIEWS_KEY = 'itowns.xr.savedTargetViews.v1';
    const DEFAULT_XR_IMMERSIVE_PLACEMENT = {
        enabled: true,
        distanceMeters: 0.85,
        heightMeters: 0.82,
        bearingDeg: 0,
    };
    const DEFAULT_XR_EYE_HEIGHT_METERS = 1.6;
    const xrImmersivePlacementState = {
        config: { ...DEFAULT_XR_IMMERSIVE_PLACEMENT },
        active: false,
        pendingStart: false,
        transform: null,
    };

    function isValidGeoPoint(geo) {
        if (!geo) return false;
        return Number.isFinite(geo.longitude) && Number.isFinite(geo.latitude);
    }

    function normalizeSavedViewEntry(raw, idx = 0) {
        if (!raw || typeof raw !== 'object') return null;
        const originTargetGeo = raw.originTargetGeo || raw.origin;
        const destinationTargetGeo = raw.destinationTargetGeo || raw.destination;
        if (!isValidGeoPoint(originTargetGeo) || !isValidGeoPoint(destinationTargetGeo)) return null;
        const scale = Number.isFinite(raw.scale) ? raw.scale : 1;
        return {
            id: `${raw.id || `sv-${Date.now().toString(36)}-${idx}`}`,
            name: (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim() : `View ${idx + 1}`,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
            scale,
            originTargetGeo: {
                longitude: originTargetGeo.longitude,
                latitude: originTargetGeo.latitude,
                altitude: Number.isFinite(originTargetGeo.altitude) ? originTargetGeo.altitude : 0,
                crs: originTargetGeo.crs || 'EPSG:4326',
            },
            destinationTargetGeo: {
                longitude: destinationTargetGeo.longitude,
                latitude: destinationTargetGeo.latitude,
                altitude: Number.isFinite(destinationTargetGeo.altitude) ? destinationTargetGeo.altitude : 0,
                crs: destinationTargetGeo.crs || 'EPSG:4326',
            },
        };
    }

    function loadSavedViews() {
        try {
            const raw = window.localStorage?.getItem?.(SAVED_TARGET_VIEWS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((entry, idx) => normalizeSavedViewEntry(entry, idx)).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    const savedViewsState = { entries: loadSavedViews() };

    function persistSavedViews() {
        try {
            window.localStorage?.setItem?.(SAVED_TARGET_VIEWS_KEY, JSON.stringify(savedViewsState.entries));
        } catch (e) {
            // no-op
        }
    }

    function updateSavedViewsUi() {
        savedViewsUi?.setItems?.(savedViewsState.entries);
    }

    function mapCenterToGlobe(fromRoot, toRoot, position) {
        if (!fromRoot || !toRoot) return position.clone();
        fromRoot.updateMatrixWorld(true);
        toRoot.updateMatrixWorld(true);
        const local = fromRoot.worldToLocal(position.clone());
        return toRoot.localToWorld(local);
    }

    function mapFromContext(position, targetRoot) {
        return mapCenterToGlobe(contextObject3D, targetRoot, position);
    }

    function getContextTransformNoScale() {
        if (!contextObject3D) return null;
        contextObject3D.updateMatrixWorld(true);
        contextObject3D.getWorldPosition(contextPosTmp);
        contextObject3D.getWorldQuaternion(contextQuatTmp);
        contextInvQuatTmp.copy(contextQuatTmp).invert();
        return { pos: contextPosTmp, quat: contextQuatTmp, invQuat: contextInvQuatTmp };
    }

    function worldToContextNoScale(world) {
        const t = getContextTransformNoScale();
        if (!t || !world) return world?.clone?.() ?? new THREE.Vector3();
        return world.clone().sub(t.pos).applyQuaternion(t.invQuat);
    }

    function projectDirectionOnPlane(v, normal, fallback = null) {
        if (!v || !normal) return fallback?.clone?.() || null;
        const n = normal.clone().normalize();
        const projected = v.clone().sub(n.multiplyScalar(v.dot(n)));
        const lenSq = projected.lengthSq();
        if (lenSq < 1e-12) return fallback?.clone?.() || null;
        return projected.multiplyScalar(1 / Math.sqrt(lenSq));
    }

    function signedAngleOnPlane(fromDir, toDir, planeNormal) {
        if (!fromDir || !toDir || !planeNormal) return 0;
        const n = planeNormal.clone().normalize();
        const a = projectDirectionOnPlane(fromDir, n);
        const b = projectDirectionOnPlane(toDir, n);
        if (!a || !b) return 0;
        const cross = new THREE.Vector3().crossVectors(a, b);
        const sin = n.dot(cross);
        const cos = THREE.MathUtils.clamp(a.dot(b), -1, 1);
        return Math.atan2(sin, cos);
    }

    function normalizeImmersivePlacementConfig(raw) {
        const cfg = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: cfg.enabled !== false,
            distanceMeters: Number.isFinite(cfg.distanceMeters) ? cfg.distanceMeters : DEFAULT_XR_IMMERSIVE_PLACEMENT.distanceMeters,
            heightMeters: Number.isFinite(cfg.heightMeters) ? cfg.heightMeters : DEFAULT_XR_IMMERSIVE_PLACEMENT.heightMeters,
            bearingDeg: Number.isFinite(cfg.bearingDeg) ? cfg.bearingDeg : DEFAULT_XR_IMMERSIVE_PLACEMENT.bearingDeg,
        };
    }

    function setXrImmersivePlacementConfig(config, { applyNow = false } = {}) {
        xrImmersivePlacementState.config = normalizeImmersivePlacementConfig(config);
        if (applyNow && xrImmersivePlacementState.active) {
            // Re-apply from current base space by first undoing active transform.
            onXRSessionEnd();
            onXRSessionStart();
        }
        return { ...xrImmersivePlacementState.config };
    }

    function getSceneCameraPose() {
        const camera = view?.camera3D;
        if (!camera) return null;
        camera.updateMatrixWorld(true);
        const headPosition = camera.position.clone();
        if (![headPosition.x, headPosition.y, headPosition.z].every(Number.isFinite)) return null;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        const floorUp = headPosition.lengthSq() > 1e-12 ? headPosition.clone().normalize() : upAxis.clone();
        return { headPosition, forward, up, floorUp };
    }

    function getXrHeadPoseDebug() {
        const xr = view?.renderer?.xr;
        if (!xr?.isPresenting) return null;
        const xrCamera = xr.getCamera?.(view.camera3D);
        if (!xrCamera) return null;
        xrCamera.updateMatrixWorld(true);
        const headPosition = new THREE.Vector3();
        xrCamera.getWorldPosition(headPosition);
        if (![headPosition.x, headPosition.y, headPosition.z].every(Number.isFinite)) return null;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(xrCamera.quaternion).normalize();
        const floorUp = headPosition.lengthSq() > 1e-12 ? headPosition.clone().normalize() : upAxis.clone();
        return { headPosition, forward, up, floorUp };
    }

    function getCurrentSystemCenter() {
        const center = stencil3?.uniforms?.uStencilCenter?.value;
        if (center && Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
            return center.clone();
        }
        const c1 = stencil1?.uniforms?.uStencilCenter?.value;
        const c2 = stencil2?.uniforms?.uStencilCenter?.value;
        if (c1 && c2) return c1.clone().add(c2).multiplyScalar(0.5);
        return new THREE.Vector3();
    }

    function getCurrentSystemUp(centerWorld) {
        const axis = stencil3?.uniforms?.uStencilAxis?.value;
        if (axis && Number.isFinite(axis.x) && Number.isFinite(axis.y) && Number.isFinite(axis.z) && axis.lengthSq() > 1e-12) {
            return axis.clone().normalize();
        }
        if (centerWorld && centerWorld.lengthSq() > 1e-12) {
            return centerWorld.clone().normalize();
        }
        return upAxis.clone();
    }

    function getCurrentSystemForward() {
        const c1 = stencil1?.uniforms?.uStencilCenter?.value;
        const c2 = stencil2?.uniforms?.uStencilCenter?.value;
        if (c1 && c2) {
            const delta = c2.clone().sub(c1);
            if (delta.lengthSq() > 1e-12) return delta.normalize();
        }
        return new THREE.Vector3(1, 0, 0);
    }

    function applyRigidTransformToObject(object3D, rotation, translation, pivot) {
        if (!object3D) return;
        if (pivot) {
            object3D.position.sub(pivot).applyQuaternion(rotation).add(pivot);
        } else {
            object3D.position.applyQuaternion(rotation);
        }
        object3D.position.add(translation);
        object3D.quaternion.premultiply(rotation);
        object3D.updateMatrixWorld(true);
    }

    function transformWorldPoint(point, rotation, translation, pivot) {
        if (!point) return null;
        const next = point.clone();
        if (pivot) next.sub(pivot).applyQuaternion(rotation).add(pivot);
        else next.applyQuaternion(rotation);
        return next.add(translation);
    }

    function applyRigidTransformToSystem(rotation, translation, pivot = null) {
        const prevSuppress = suppressAutoAlignment;
        suppressAutoAlignment = true;
        try {
            applyRigidTransformToObject(contextObject3D, rotation, translation, pivot);
            applyRigidTransformToObject(originObject3D, rotation, translation, pivot);
            applyRigidTransformToObject(destinationObject3D, rotation, translation, pivot);

            const c1 = transformWorldPoint(stencil1.uniforms?.uStencilCenter?.value, rotation, translation, pivot);
            const c2 = transformWorldPoint(stencil2.uniforms?.uStencilCenter?.value, rotation, translation, pivot);
            const c3 = transformWorldPoint(stencil3.uniforms?.uStencilCenter?.value, rotation, translation, pivot);
            if (c1) setStencilCenter(stencil1, originObject3D, originLayer, c1);
            if (c2) setStencilCenter(stencil2, destinationObject3D, destinationLayer, c2);
            if (c3) setStencilCenter(stencil3, contextObject3D, contextLayer, c3);
        } finally {
            suppressAutoAlignment = prevSuppress;
        }

        if (contextModeState.enabled) {
            updateContextCylinders();
        }
        view.notifyChange(true);
    }

    function buildImmersiveTransform() {
        const cfg = xrImmersivePlacementState.config;
        if (!cfg?.enabled) return null;

        const headPose = getSceneCameraPose();
        if (!headPose) return null;
        const center = getCurrentSystemCenter();
        const systemUp = getCurrentSystemUp(center);
        const systemForward = getCurrentSystemForward();
        const floorUp = (headPose.floorUp && headPose.floorUp.lengthSq() > 1e-12) ? headPose.floorUp.clone().normalize() : upAxis.clone();

        const userForward = projectDirectionOnPlane(headPose.forward, floorUp, new THREE.Vector3(0, 0, -1));
        if (!userForward) return null;
        const bearingRad = THREE.MathUtils.degToRad(cfg.bearingDeg || 0);
        const placementDirection = userForward.clone().applyAxisAngle(floorUp, bearingRad).normalize();

        const qUp = new THREE.Quaternion().setFromUnitVectors(systemUp, floorUp);
        const forwardAfterUp = projectDirectionOnPlane(systemForward.clone().applyQuaternion(qUp), floorUp, new THREE.Vector3(1, 0, 0));
        if (!forwardAfterUp) return null;

        const deltaYaw = signedAngleOnPlane(forwardAfterUp, placementDirection, floorUp);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(floorUp, deltaYaw);
        const rotation = qYaw.multiply(qUp);

        // Interpret configured table height as "meters above floor". We convert
        // it to a headset-relative offset to avoid dependence on absolute
        // scene coordinates (important for ECEF/world-scale scenes).
        const verticalOffsetFromHead = cfg.heightMeters - DEFAULT_XR_EYE_HEIGHT_METERS;
        const desiredCenter = headPose.headPosition.clone()
            .add(placementDirection.multiplyScalar(cfg.distanceMeters))
            .add(floorUp.multiplyScalar(verticalOffsetFromHead));

        const translation = desiredCenter.sub(center);

        return { rotation, translation, pivot: center.clone(), floorUp };
    }

    function onXRSessionStart() {
        if (!isGlobeInitialized) {
            xrImmersivePlacementState.pendingStart = true;
            return false;
        }
        if (xrImmersivePlacementState.config?.enabled === false) {
            xrImmersivePlacementState.pendingStart = false;
            return true;
        }
        if (xrImmersivePlacementState.active) return true;

        const transform = buildImmersiveTransform();
        if (!transform) return false;

        applyRigidTransformToSystem(transform.rotation, transform.translation, transform.pivot);
        xrImmersivePlacementState.transform = {
            rotation: transform.rotation.clone(),
            translation: transform.translation.clone(),
            pivot: transform.pivot?.clone?.() || null,
        };
        xrImmersivePlacementState.active = true;
        xrImmersivePlacementState.pendingStart = false;
        requestCameraRefresh({ frames: 24 });
        return true;
    }

    function onXRSessionEnd() {
        if (!xrImmersivePlacementState.active || !xrImmersivePlacementState.transform) return false;
        const qInv = xrImmersivePlacementState.transform.rotation.clone().invert();
        const tInv = xrImmersivePlacementState.transform.translation.clone().applyQuaternion(qInv).multiplyScalar(-1);
        applyRigidTransformToSystem(qInv, tInv, xrImmersivePlacementState.transform.pivot || null);
        xrImmersivePlacementState.transform = null;
        xrImmersivePlacementState.active = false;
        xrImmersivePlacementState.pendingStart = false;
        requestCameraRefresh({ frames: 12 });
        return true;
    }

    function dumpXrPlacementDebug() {
        const scenePose = getSceneCameraPose();
        const xrPose = getXrHeadPoseDebug();
        const center = getCurrentSystemCenter();
        const systemUp = getCurrentSystemUp(center);
        const systemForward = getCurrentSystemForward();
        const computed = buildImmersiveTransform();
        const snapshot = {
            presenting: !!view?.renderer?.xr?.isPresenting,
            config: { ...xrImmersivePlacementState.config },
            active: xrImmersivePlacementState.active,
            pendingStart: xrImmersivePlacementState.pendingStart,
            scenePose: scenePose ? {
                headPosition: serializeVector3(scenePose.headPosition),
                forward: serializeVector3(scenePose.forward),
                up: serializeVector3(scenePose.up),
                floorUp: serializeVector3(scenePose.floorUp),
            } : null,
            xrPose: xrPose ? {
                headPosition: serializeVector3(xrPose.headPosition),
                forward: serializeVector3(xrPose.forward),
                up: serializeVector3(xrPose.up),
                floorUp: serializeVector3(xrPose.floorUp),
            } : null,
            system: {
                center: serializeVector3(center),
                up: serializeVector3(systemUp),
                forward: serializeVector3(systemForward),
            },
            activeTransform: xrImmersivePlacementState.transform ? {
                rotation: serializeQuaternion(xrImmersivePlacementState.transform.rotation),
                translation: serializeVector3(xrImmersivePlacementState.transform.translation),
                pivot: serializeVector3(xrImmersivePlacementState.transform.pivot),
            } : null,
            computedTransform: computed ? {
                rotation: serializeQuaternion(computed.rotation),
                translation: serializeVector3(computed.translation),
                pivot: serializeVector3(computed.pivot),
                floorUp: serializeVector3(computed.floorUp),
            } : null,
        };
        console.log('[itowns-xr] xr placement debug', snapshot);
        return snapshot;
    }

    function scheduleXRSessionStartPlacement({ maxFrames = 60 } = {}) {
        let framesLeft = Math.max(1, Math.floor(Number(maxFrames) || 1));
        const tick = () => {
            if (!view?.renderer?.xr?.isPresenting) return;
            if (onXRSessionStart()) return;
            framesLeft -= 1;
            if (framesLeft > 0) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    function requestCameraRefresh({ frames = 18 } = {}) {
        const count = Math.max(1, Math.floor(Number(frames) || 1));
        const source = view.camera3D || view.camera;
        let left = count;
        const tick = () => {
            view.notifyChange(source);
            left -= 1;
            if (left > 0) requestAnimationFrame(tick);
        };
        tick();
    }

    function intersectContextEllipsoid(ray) {
        if (!ray || !contextObject3D) return null;
        const t = getContextTransformNoScale();
        if (!t) return null;
        contextObject3D.getWorldScale(contextScaleTmp);
        const scale = (contextScaleTmp.x + contextScaleTmp.y + contextScaleTmp.z) / 3;
        if (!Number.isFinite(scale) || scale <= 0) return null;

        const originLocal = ray.origin.clone().sub(t.pos).applyQuaternion(t.invQuat);
        const dirLocal = ray.direction.clone().applyQuaternion(t.invQuat);
        const localRay = new THREE.Ray(originLocal, dirLocal);

        pickEllipsoid.setSize(contextScaleTmp.copy(baseEllipsoidSize).multiplyScalar(scale));
        const hitLocal = pickEllipsoid.intersection(localRay);
        if (!hitLocal) return null;
        return hitLocal.applyQuaternion(t.quat).add(t.pos);
    }

    function updateAxisForCenter(center, globeRoot, uniforms, mesh) {
        if (!center || !mesh) return;
        axisTmp.copy(center);
        if (globeRoot) axisTmp.sub(globeRoot.position);
        if (axisTmp.lengthSq() < 1e-8) {
            axisTmp.copy(upAxis);
        } else {
            axisTmp.normalize();
        }
        if (uniforms?.uStencilAxis) uniforms.uStencilAxis.value.copy(axisTmp);
        mesh.quaternion.copy(axisQuat.setFromUnitVectors(upAxis, axisTmp));
        mesh.updateMatrixWorld(true);
    }

    function setStencilCenter(stencil, globeRoot, layer, position) {
        stencil.cylinder.setCenterECEF(position);
        updateAxisForCenter(stencil.uniforms.uStencilCenter.value, globeRoot, stencil.uniforms, stencil.cylinder.mesh);
        if (!suppressAutoAlignment && verticalAlignState.auto) {
            applyVerticalAlignment(verticalAlignState.method);
        }
    }

    function setGhostCenter(ghost, globeRoot, position) {
        ghost.setCenterECEF(position);
        updateAxisForCenter(position, globeRoot, null, ghost.mesh);
    }

    function getTerrainWorldAt(globeRoot, layer, centerWorld) {
        if (!globeRoot || !layer || !centerWorld) return null;
        const local = globeRoot.worldToLocal(centerWorld.clone());
        if (!Number.isFinite(local.x) || !Number.isFinite(local.y) || !Number.isFinite(local.z)) return null;
        const coord = new itowns.Coordinates(view.referenceCrs, local.x, local.y, local.z);
        const elevation = itowns.DEMUtils.getElevationValueAt(layer, coord, itowns.DEMUtils.FAST_READ_Z);
        if (!Number.isFinite(elevation)) return null;
        const geo = coord.as('EPSG:4326');
        const terrainCoord = new itowns.Coordinates('EPSG:4326', geo.longitude, geo.latitude, elevation);
        const terrainLocal = terrainCoord.as(view.referenceCrs);
        return globeRoot.localToWorld(new THREE.Vector3(terrainLocal.x, terrainLocal.y, terrainLocal.z));
    }

    function alignGlobeToTerrain(globeRoot, layer, centerWorld) {
        if (!globeRoot || !layer || !centerWorld) return;
        const terrainWorld = getTerrainWorldAt(globeRoot, layer, centerWorld);
        if (!terrainWorld) return;
        const globeCenterWorld = new THREE.Vector3();
        globeRoot.getWorldPosition(globeCenterWorld);
        const axis = centerWorld.clone().sub(globeCenterWorld).normalize();
        const delta = centerWorld.clone().sub(terrainWorld).dot(axis);
        if (Math.abs(delta) < 1e-3) return;
        globeRoot.position.add(axis.multiplyScalar(delta));
        globeRoot.updateMatrixWorld(true);
    }

    function applyVerticalAlignment(method = verticalAlignState.method) {
        const stencils = [
            { stencil: stencil1, root: originObject3D, layer: originLayer },
            { stencil: stencil2, root: destinationObject3D, layer: destinationLayer },
            { stencil: stencil3, root: contextObject3D, layer: contextLayer },
        ];

        stencils.forEach(({ stencil, root, layer }) => {
            if (!stencil?.uniforms?.uStencilCenter?.value || !root) return;
            const centerWorld = stencil.uniforms.uStencilCenter.value;
            const terrainWorld = getTerrainWorldAt(root, layer, centerWorld);
            if (!terrainWorld) return;

            const delta = centerWorld.clone().sub(terrainWorld);
            let move = new THREE.Vector3();
            if (method === 'direct') {
                move.copy(delta);
            } else if (method === 'world-up') {
                move.copy(upAxis).multiplyScalar(delta.dot(upAxis));
            } else {
                const globeCenterWorld = new THREE.Vector3();
                root.getWorldPosition(globeCenterWorld);
                const axis = centerWorld.clone().sub(globeCenterWorld);
                if (axis.lengthSq() < 1e-8) axis.copy(upAxis);
                axis.normalize();
                move.copy(axis).multiplyScalar(delta.dot(axis));
            }

            if (move.lengthSq() < 1e-6) return;
            root.position.add(move);
            root.updateMatrixWorld(true);
            updateAxisForCenter(centerWorld, root, stencil.uniforms, stencil.cylinder.mesh);
        });

        view.notifyChange(true);
    }

    function getStencilCenterRadius(stencil) {
        const center = stencil?.uniforms?.uStencilCenter?.value;
        if (!center) return null;
        const len = center.length();
        return Number.isFinite(len) ? len : null;
    }

    function resolveTargetRadius(target) {
        if (target === 'context') return getStencilCenterRadius(stencil3);
        if (target === 'origin') return getStencilCenterRadius(stencil1);
        if (target === 'destination') return getStencilCenterRadius(stencil2);
        if (target === 'average') {
            const values = [
                getStencilCenterRadius(stencil1),
                getStencilCenterRadius(stencil2),
                getStencilCenterRadius(stencil3),
            ].filter((v) => Number.isFinite(v));
            if (!values.length) return null;
            return values.reduce((sum, v) => sum + v, 0) / values.length;
        }
        return null;
    }

    function alignCylindersToRadius(target = 'context', includeContext = false) {
        const targetRadius = resolveTargetRadius(target);
        if (!Number.isFinite(targetRadius)) return;
        const entries = [
            { stencil: stencil1, root: originObject3D },
            { stencil: stencil2, root: destinationObject3D },
        ];
        if (includeContext) entries.push({ stencil: stencil3, root: contextObject3D });

        entries.forEach(({ stencil, root }) => {
            const center = stencil?.uniforms?.uStencilCenter?.value;
            if (!center || !root) return;
            const len = center.length();
            if (!Number.isFinite(len) || len < 1e-6) return;
            const delta = targetRadius - len;
            if (Math.abs(delta) < 1e-3) return;
            const offset = center.clone().normalize().multiplyScalar(delta);
            const nextCenter = center.clone().add(offset);
            stencil.cylinder.setCenterECEF(nextCenter);
            root.position.add(offset);
            root.updateMatrixWorld(true);
            updateAxisForCenter(stencil.uniforms.uStencilCenter.value, root, stencil.uniforms, stencil.cylinder.mesh);
        });

        updateContextCylinders();
        view.notifyChange(true);
    }

    function computeBearingInContext(p1World, p2World) {
        if (!p1World || !p2World) return 0;
        const p1Local = worldToContextNoScale(p1World);
        const p2Local = worldToContextNoScale(p2World);
        const up = p1Local.clone().normalize();
        if (up.lengthSq() < 1e-8) return 0;
        const zAxis = new THREE.Vector3(0, 0, 1);
        let east = new THREE.Vector3().crossVectors(zAxis, up);
        if (east.lengthSq() < 1e-8) {
            const yAxis = new THREE.Vector3(0, 1, 0);
            east = new THREE.Vector3().crossVectors(yAxis, up);
        }
        east.normalize();
        const north = new THREE.Vector3().crossVectors(up, east).normalize();
        const delta = p2Local.clone().sub(p1Local);
        const e = delta.dot(east);
        const n = delta.dot(north);
        return Math.atan2(n, e);
    }

    const SCALE_MIN = 1 / 100000;
    const SCALE_MAX = 1;

    function scaleFromSlider01(u) {
        const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
        return SCALE_MIN * Math.pow(SCALE_MAX / SCALE_MIN, clamped);
    }

    function slider01FromScale(scale) {
        const clamped = THREE.MathUtils.clamp(+scale || SCALE_MIN, SCALE_MIN, SCALE_MAX);
        return Math.log(clamped / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN);
    }

    function formatScaleRatio(scale) {
        const denom = Math.max(1, Math.round(1 / scale));
        return `1:${denom.toLocaleString('en-US')}`;
    }

    function updateRadiusLabelForScale(panel, idPrefix, baseScale, currentScale) {
        const input = panel.querySelector(`#${idPrefix}-r`);
        const label = panel.querySelector(`#${idPrefix}-rv`);
        const rawLabel = panel.querySelector(`#${idPrefix}-rv-raw`);
        if (!input || !label) return;
        const u = parseFloat(input.value);
        if (!Number.isFinite(u)) return;
        const scale = currentScale || globeScaleState.value || 1;
        const baseRadius = radiusFromSlider01(u) * baseScale;
        const radius = baseRadius / scale;
        label.textContent = formatMeters(radius);
        if (rawLabel) rawLabel.textContent = formatMeters(baseRadius);
    }

    function updateAllRadiusLabels() {
        const scale = globeScaleState.value || 1;
        if (stencil1.ui?.panel) updateRadiusLabelForScale(stencil1.ui.panel, stencil1.id, originScale, scale);
        if (stencil2.ui?.panel) updateRadiusLabelForScale(stencil2.ui.panel, stencil2.id, destinationScale, scale);
        if (stencil3.ui?.panel) updateRadiusLabelForScale(stencil3.ui.panel, stencil3.id, contextScale, scale);
    }

    function getStencilRadiusU(stencil) {
        if (!stencil) return NaN;
        if (Number.isFinite(stencil.radiusU)) return stencil.radiusU;
        const input = stencil.ui?.panel?.querySelector?.(`#${stencil.id}-r`);
        if (!input) return NaN;
        const u = parseFloat(input.value);
        if (Number.isFinite(u)) stencil.radiusU = u;
        return u;
    }

    function computeScaledRadius(u, baseScale) {
        return radiusFromSlider01(u) * baseScale;
    }

    function applyRadiusForStencil(stencil, baseScale, u) {
        const val = Number.isFinite(u) ? u : getStencilRadiusU(stencil);
        if (!Number.isFinite(val)) return;
        stencil.radiusU = val;
        stencil.cylinder.setRadiusMeters(computeScaledRadius(val, baseScale));
    }

    function applyAllStencilRadii() {
        applyRadiusForStencil(stencil1, originScale);
        applyRadiusForStencil(stencil2, destinationScale);
        applyRadiusForStencil(stencil3, contextScale);
        updateContextCylinders();
        updateAllRadiusLabels();
    }

    function computePositionBearing() {
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (!p1 || !p2) return 0;
        // Use world/context bearing instead of screen-space bearing so camera
        // heading changes do not alter counter-rotation.
        return computeBearingInContext(p1, p2);
    }

    function computeTargetBearing() {
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (!p1 || !p2) return 0;
        const p1Context = mapCenterToGlobe(originObject3D, contextObject3D, p1);
        const p2Context = mapCenterToGlobe(destinationObject3D, contextObject3D, p2);
        return computeBearingInContext(p1Context, p2Context);
    }

    function rotateGlobeAroundStencil(globeRoot, center, angle) {
        if (!globeRoot || !center) return;
        const axis = center.clone().sub(globeRoot.position).normalize();
        rotateAroundPoint(globeRoot, center.clone(), axis, angle);
    }

    function rotateRootToTargetAtStencil(globeRoot, desiredCenterWorld, targetWorld) {
        if (!globeRoot || !desiredCenterWorld || !targetWorld) return false;
        const center = new THREE.Vector3();
        globeRoot.getWorldPosition(center);
        const tDir = targetWorld.clone().sub(center).normalize();
        const dDir = desiredCenterWorld.clone().sub(center).normalize();
        if (tDir.lengthSq() < 1e-6 || dDir.lengthSq() < 1e-6) return false;
        const q = new THREE.Quaternion().setFromUnitVectors(tDir, dDir);
        globeRoot.quaternion.premultiply(q);
        globeRoot.updateMatrixWorld(true);
        return true;
    }

    function applyGlobeScale(nextScale) {
        const clamped = THREE.MathUtils.clamp(+nextScale || 1, SCALE_MIN, SCALE_MAX);
        scaleUi?.setScale?.(clamped);
        const factor = clamped / globeScaleState.value;
        if (Math.abs(factor - 1) < 1e-6) return;
        globeScaleState.value = clamped;
        scaleAroundPoint(originObject3D, stencil1.uniforms.uStencilCenter.value, factor);
        scaleAroundPoint(destinationObject3D, stencil2.uniforms.uStencilCenter.value, factor);
        scaleAroundPoint(contextObject3D, stencil3.uniforms.uStencilCenter.value, factor);
        if (!suppressAutoAlignment && verticalAlignState.auto) {
            applyVerticalAlignment(verticalAlignState.method);
        }
        updateAxisForCenter(stencil1.uniforms.uStencilCenter.value, originObject3D, stencil1.uniforms, stencil1.cylinder.mesh);
        updateAxisForCenter(stencil2.uniforms.uStencilCenter.value, destinationObject3D, stencil2.uniforms, stencil2.cylinder.mesh);
        updateAxisForCenter(stencil3.uniforms.uStencilCenter.value, contextObject3D, stencil3.uniforms, stencil3.cylinder.mesh);
        if (contextModeState.enabled) {
            updateAxisForCenter(ghostBlue.mesh.position, contextObject3D, null, ghostBlue.mesh);
            updateAxisForCenter(ghostRed.mesh.position, contextObject3D, null, ghostRed.mesh);
        }
        updateGreenFromBlueRed();
        applyAllStencilRadii();
        view.notifyChange(true);
    }

    function normalizeAngleRad(angle) {
        if (!Number.isFinite(angle)) return angle;
        let a = angle;
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    function computeDesiredCounterRotation() {
        const targetBearing = computeTargetBearing();
        const positionBearing = computePositionBearing();
        if (!Number.isFinite(targetBearing) || !Number.isFinite(positionBearing)) return null;
        // Both bearings are in world/context frame (east=0, north=+).
        const desired = normalizeAngleRad(positionBearing - targetBearing);
        return { targetBearing, positionBearing, desired };
    }

    function applyCounterRotation({ maxIterations = 1, epsilon = 1e-6 } = {}) {
        if (contextModeState.enabled) return;
        const iterations = Math.max(1, Math.floor(Number(maxIterations) || 1));
        let changed = false;
        for (let i = 0; i < iterations; i++) {
            const solved = computeDesiredCounterRotation();
            if (!solved) break;
            // Apply the current alignment error directly. For some globe
            // configurations this is slightly non-linear, so allow a small
            // fixed-point iteration budget when requested.
            const correction = normalizeAngleRad(solved.desired);
            if (Math.abs(correction) < epsilon) break;
            rotateGlobeAroundStencil(originObject3D, stencil1.uniforms.uStencilCenter.value, correction);
            rotateGlobeAroundStencil(destinationObject3D, stencil2.uniforms.uStencilCenter.value, correction);
            counterRotationState.angleRad = normalizeAngleRad(counterRotationState.angleRad + correction);
            const q1Aligned = originObject3D ? originObject3D.quaternion : identityQuat;
            tempQuat.copy(q1Aligned).slerp(destinationObject3D.quaternion, 0.5);
            contextObject3D.quaternion.copy(tempQuat);
            contextObject3D.updateMatrixWorld(true);
            changed = true;
        }
        if (changed) {
            view.notifyChange(true);
        }
    }

    function clearCounterRotation() {
        if (Math.abs(counterRotationState.angleRad) < 1e-6) return;
        const delta = normalizeAngleRad(-counterRotationState.angleRad);
        rotateGlobeAroundStencil(originObject3D, stencil1.uniforms.uStencilCenter.value, delta);
        rotateGlobeAroundStencil(destinationObject3D, stencil2.uniforms.uStencilCenter.value, delta);
        counterRotationState.angleRad = 0;
        view.notifyChange(true);
    }

    function pickContextAt(coords) {
        const picks = view.tileLayer ? view.pickObjectsAt(coords, 2, view.tileLayer) : null;
        if (picks && picks.length) {
            const hit = picks.find((p) => p && p.point) || picks[0];
            if (hit && hit.point) return hit.point.clone();
        }
        view.viewToNormalizedCoords(coords, pickNdc);
        pickRaycaster.setFromCamera(pickNdc, view.camera3D);
        const hit = intersectContextEllipsoid(pickRaycaster.ray);
        return hit || undefined;
    }

    function getPickedContext(event) {
        return pickContextAt(view.eventToViewCoords(event));
    }

    function updateContextCylinders() {
        if (!contextModeState.enabled) return;
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (p1) setGhostCenter(ghostBlue, contextObject3D, mapCenterToGlobe(originObject3D, contextObject3D, p1));
        if (p2) setGhostCenter(ghostRed, contextObject3D, mapCenterToGlobe(destinationObject3D, contextObject3D, p2));
        const u1 = getStencilRadiusU(stencil1);
        const u2 = getStencilRadiusU(stencil2);
        if (Number.isFinite(u1)) {
            const base1 = radiusFromSlider01(u1);
            ghostBlue.setRadiusMeters(base1 * contextScale);
        }
        if (Number.isFinite(u2)) {
            const base2 = radiusFromSlider01(u2);
            ghostRed.setRadiusMeters(base2 * contextScale);
        }
        ghostBlue.setOpacity(stencil1.cylinder.mesh.material.opacity);
        ghostRed.setOpacity(stencil2.cylinder.mesh.material.opacity);
        ghostBlue.mesh.visible = contextModeState.cyl1Visible;
        ghostRed.mesh.visible = contextModeState.cyl2Visible;
    }

    function setContextMode(enabled) {
        const next = !!enabled;
        if (contextModeState.enabled === next) {
            updateContextButton(next);
            return;
        }
        contextModeState.enabled = next;
        if (contextModeState.enabled) {
            clearCounterRotation();
            updateGreenFromBlueRed();
            contextModeState.globe1Visible = originObject3D.visible;
            contextModeState.globe2Visible = destinationObject3D.visible;
            contextModeState.cyl1Visible = stencil1.cylinder.mesh.visible;
            contextModeState.cyl2Visible = stencil2.cylinder.mesh.visible;
            contextModeState.stencil3Enabled = stencil3.uniforms.uStencilEnabled.value > 0.5;
            originObject3D.visible = false;
            destinationObject3D.visible = false;
            stencil1.cylinder.mesh.visible = false;
            stencil2.cylinder.mesh.visible = false;
            stencil3.ui.setStencilEnabled(false);
            ghostBlue.mesh.visible = contextModeState.cyl1Visible;
            ghostRed.mesh.visible = contextModeState.cyl2Visible;
            updateContextCylinders();
        } else {
            originObject3D.visible = contextModeState.globe1Visible;
            destinationObject3D.visible = contextModeState.globe2Visible;
            stencil1.cylinder.mesh.visible = contextModeState.cyl1Visible;
            stencil2.cylinder.mesh.visible = contextModeState.cyl2Visible;
            stencil3.ui.setStencilEnabled(contextModeState.stencil3Enabled);
            ghostBlue.mesh.visible = false;
            ghostRed.mesh.visible = false;
            updateGreenFromBlueRed();
        }
        updateContextButton(contextModeState.enabled);
        view.notifyChange(true);
    }

    function updateGreenFromBlueRed() {
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (!p1 || !p2) return;
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        setStencilCenter(stencil3, contextObject3D, contextLayer, mid);

        const q1 = originObject3D ? originObject3D.quaternion : identityQuat;
        tempQuat.copy(q1).slerp(destinationObject3D.quaternion, 0.5);
        contextObject3D.quaternion.copy(tempQuat);
        contextObject3D.updateMatrixWorld(true);

        if (!suppressAutoAlignment && cylinderAlignState.auto) {
            alignCylindersToRadius(cylinderAlignState.target);
        }
        if (!suppressAutoAlignment && !contextModeState.enabled) {
            applyCounterRotation();
            const q1Aligned = originObject3D ? originObject3D.quaternion : identityQuat;
            tempQuat.copy(q1Aligned).slerp(destinationObject3D.quaternion, 0.5);
            contextObject3D.quaternion.copy(tempQuat);
            contextObject3D.updateMatrixWorld(true);
        }
        view.notifyChange(true);
        updateContextCylinders();
    }

    function initStencilCenters() {
        const c = view.controls.getLookAtCoordinate();
        const g = c.as(view.referenceCrs);
        const pContext = new THREE.Vector3(g.x, g.y, g.z);

        const p1 = mapFromContext(pContext, originObject3D);
        const p2 = mapFromContext(pContext, destinationObject3D);
        setStencilCenter(stencil1, originObject3D, originLayer, p1);
        setStencilCenter(stencil2, destinationObject3D, destinationLayer, p2);

        updateGreenFromBlueRed();
    }

    function setExclusivePicking(stencil, active) {
        // make picking exclusive to avoid ambiguity
        if (stencil === stencil1 && active) {
            stencil2.picking = false;
            stencil2.ui.setPicking(false);
        }
        if (stencil === stencil2 && active) {
            stencil1.picking = false;
            stencil1.ui.setPicking(false);
        }
        stencil.picking = active;
    }

    function rotateGlobe2ToTarget(targetECEF) {
        if (!contextModeState.enabled) {
            clearCounterRotation();
        }
        const desired = stencil2.uniforms.uStencilCenter.value;
        if (!desired) return;
        if (!rotateRootToTargetAtStencil(destinationObject3D, desired, targetECEF)) return;
        view.notifyChange(true);
        updateGreenFromBlueRed();
    }

    function rotateGlobe1ToTarget(targetECEF) {
        if (!contextModeState.enabled) {
            clearCounterRotation();
        }
        const desired = stencil1.uniforms.uStencilCenter.value;
        if (!desired || !originObject3D) return;
        if (!rotateRootToTargetAtStencil(originObject3D, desired, targetECEF)) return;
        view.notifyChange(true);
        updateGreenFromBlueRed();
    }

    function repositionMaskWithRotation({ stencil, targetWorld, globeRoot }) {
        const desired = stencil.uniforms.uStencilCenter.value;
        if (!desired || !targetWorld) return;
        if (!contextModeState.enabled && (stencil === stencil1 || stencil === stencil2)) {
            clearCounterRotation();
        }
        if (globeRoot) {
            const center = new THREE.Vector3();
            globeRoot.getWorldPosition(center);
            const fromDir = desired.clone().sub(center);
            const toDir = targetWorld.clone().sub(center);
            if (fromDir.lengthSq() > 1e-6 && toDir.lengthSq() > 1e-6) {
                const q = new THREE.Quaternion().setFromUnitVectors(fromDir.normalize(), toDir.normalize());
                globeRoot.quaternion.premultiply(q);
                globeRoot.updateMatrixWorld(true);
            }
        }
        const layer = stencil === stencil1 ? originLayer : destinationLayer;
        setStencilCenter(stencil, globeRoot, layer, targetWorld);
    }

    function centerCylinderAtScreenCenter(stencil) {
        const gfx = view.mainLoop?.gfxEngine;
        const x = gfx?.width ? gfx.width * 0.5 : viewerDiv.clientWidth * 0.5;
        const y = gfx?.height ? gfx.height * 0.5 : viewerDiv.clientHeight * 0.5;
        const picked = pickContextAt({ x, y });
        const targetContext = picked || getLookAtECEF();

        if (stencil === stencil2) {
            setStencilCenter(stencil2, destinationObject3D, destinationLayer, targetContext);
        } else {
            setStencilCenter(stencil1, originObject3D, originLayer, targetContext);
        }
        if (stencil === stencil1 || stencil === stencil2) updateGreenFromBlueRed();
        view.notifyChange(true);
    }

    stencil1.ui = createStencilWidget({
        idPrefix: stencil1.id,
        title: stencil1.title,
        panelPos: stencil1.panelPos,
        onTogglePick: (active) => {
            setExclusivePicking(stencil1, active);
        },
        pickButtonLabel: 'Reposition mask',
        onToggleRotate: (active) => {
            stencil1.rotating = active;
            if (active) {
                if (!contextModeState.enabled) {
                    contextModePrev.active = true;
                    contextModePrev.owner = stencil1.id;
                } else {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                }
                setContextMode(true);
                // Disable other pick modes for clarity
                stencil1.picking = false;
                stencil2.picking = false;
                stencil1.ui.setPicking(false);
                stencil2.ui.setPicking(false);
                stencil2.rotating = false;
                stencil2.ui.setRotateMode(false);
            } else {
                if (contextModePrev.active && contextModePrev.owner === stencil1.id) {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                    setContextMode(false);
                }
            }
        },
        onRadius01: (u) => {
            applyRadiusForStencil(stencil1, originScale, u);
            updateContextCylinders();
            updateAllRadiusLabels();
        },
        onOpacity: (a) => {
            stencil1.cylinder.setOpacity(a);
            updateContextCylinders();
        },
        onReset: () => centerCylinderAtScreenCenter(stencil1),
        onToggleCylinder: (vis) => {
            if (contextModeState.enabled) {
                contextModeState.cyl1Visible = vis;
                stencil1.cylinder.mesh.visible = false;
                ghostBlue.mesh.visible = vis;
            } else {
                stencil1.cylinder.mesh.visible = vis;
            }
            view.notifyChange(true);
        },
        onToggleStencil: (enabled) => { stencil1.state.stencilEnabled = enabled; stencil1.uniforms.uStencilEnabled.value = enabled ? 1.0 : 0.0; view.notifyChange(true); },
        onLog: () => logMaterialsForRoot(stencil1.patchRoot(), stencil1.id),
        panelStyle: { boxShadow: '0 14px 40px rgba(47, 139, 255, 0.45)', borderColor: '#2f8bff66' },
        rotateButtonLabel: 'Pick target',
        controls: { resetGlobe: false },
    });

    stencil2.ui = createStencilWidget({
        idPrefix: stencil2.id,
        title: stencil2.title,
        panelPos: stencil2.panelPos,
        onTogglePick: (active) => {
            setExclusivePicking(stencil2, active);
        },
        pickButtonLabel: 'Reposition mask',
        onRadius01: (u) => {
            applyRadiusForStencil(stencil2, destinationScale, u);
            updateContextCylinders();
            updateAllRadiusLabels();
        },
        onOpacity: (a) => {
            stencil2.cylinder.setOpacity(a);
            updateContextCylinders();
        },
        onReset: () => centerCylinderAtScreenCenter(stencil2),
        onToggleCylinder: (vis) => {
            if (contextModeState.enabled) {
                contextModeState.cyl2Visible = vis;
                stencil2.cylinder.mesh.visible = false;
                ghostRed.mesh.visible = vis;
            } else {
                stencil2.cylinder.mesh.visible = vis;
            }
            view.notifyChange(true);
        },
        onToggleStencil: (enabled) => { stencil2.state.stencilEnabled = enabled; stencil2.uniforms.uStencilEnabled.value = enabled ? 1.0 : 0.0; view.notifyChange(true); },
        onToggleRotate: (active) => {
            stencil2.rotating = active;
            if (active) {
                if (!contextModeState.enabled) {
                    contextModePrev.active = true;
                    contextModePrev.owner = stencil2.id;
                } else {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                }
                setContextMode(true);
                // Disable other pick modes for clarity
                stencil1.picking = false;
                stencil2.picking = false;
                stencil1.ui.setPicking(false);
                stencil2.ui.setPicking(false);
                stencil1.rotating = false;
                stencil1.ui.setRotateMode(false);
            } else {
                if (contextModePrev.active && contextModePrev.owner === stencil2.id) {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                    setContextMode(false);
                }
            }
        },
        onLog: () => logMaterialsForRoot(stencil2.patchRoot(), stencil2.id),
        panelStyle: { boxShadow: '0 14px 40px rgba(255, 51, 68, 0.45)', borderColor: '#ff334466' },
        rotateButtonLabel: 'Pick target',
        controls: { resetGlobe: false },
    });

    stencil3.ui = createStencilWidget({
        idPrefix: stencil3.id,
        title: stencil3.title,
        panelPos: stencil3.panelPos,
        onRadius01: (u) => {
            applyRadiusForStencil(stencil3, contextScale, u);
            updateAllRadiusLabels();
        },
        onOpacity: (a) => stencil3.cylinder.setOpacity(a),
        onToggleCylinder: (vis) => { stencil3.cylinder.mesh.visible = vis; view.notifyChange(true); },
        onToggleStencil: (enabled) => { stencil3.state.stencilEnabled = enabled; stencil3.uniforms.uStencilEnabled.value = enabled ? 1.0 : 0.0; view.notifyChange(true); },
        panelStyle: { boxShadow: '0 14px 40px rgba(46, 204, 113, 0.45)', borderColor: '#2ecc7166' },
        controls: {
            pick: false,
            center: false,
            log: false,
            rotate: false,
            resetGlobe: false,
            status: false,
        },
    });

    const { setContextButtonState } = attachContextControls({
        panel: stencil3.ui.panel,
        initialEnabled: contextModeState.enabled,
        onToggle: (next) => setContextMode(next),
        onReset: () => {
            originObject3D.quaternion.copy(contextObject3D.quaternion);
            originObject3D.updateMatrixWorld(true);
            destinationObject3D.quaternion.copy(contextObject3D.quaternion);
            destinationObject3D.updateMatrixWorld(true);
            view.notifyChange(true);
            updateGreenFromBlueRed();
        },
    });
    updateContextButton = setContextButtonState;

    scaleUi = attachScaleControls({
        panel: stencil3.ui.panel,
        initialScale: globeScaleState.value,
        sliderFromScale: slider01FromScale,
        scaleFromSlider: scaleFromSlider01,
        formatScale: formatScaleRatio,
        onScale: (scale) => {
            applyGlobeScale(scale);
        },
    });
    applyAllStencilRadii();

    function serializeVector3(v) {
        if (!v) return null;
        return { x: v.x, y: v.y, z: v.z };
    }

    function serializeQuaternion(q) {
        if (!q) return null;
        return { x: q.x, y: q.y, z: q.z, w: q.w };
    }

    function serializeObject3D(obj) {
        if (!obj) return null;
        return {
            position: serializeVector3(obj.position),
            quaternion: serializeQuaternion(obj.quaternion),
            scale: serializeVector3(obj.scale),
            visible: obj.visible,
        };
    }

    function serializeCamera() {
        const cam = view?.camera3D;
        if (!cam) return null;
        return {
            position: serializeVector3(cam.position),
            quaternion: serializeQuaternion(cam.quaternion),
            near: cam.near,
            far: cam.far,
            fov: cam.fov,
            aspect: cam.aspect,
            type: cam.type,
        };
    }

    function serializeControls() {
        const targetCoord = view.controls?.getLookAtCoordinate?.();
        const targetECEF = targetCoord?.as?.(view.referenceCrs);
        const targetGeo = targetCoord?.as?.('EPSG:4326');
        return {
            range: view.controls?.getRange?.() ?? null,
            tilt: view.controls?.getTilt?.() ?? null,
            heading: view.controls?.getHeading?.() ?? null,
            targetECEF: targetECEF ? { x: targetECEF.x, y: targetECEF.y, z: targetECEF.z, crs: view.referenceCrs } : null,
            targetGeo: targetGeo ? { longitude: targetGeo.longitude, latitude: targetGeo.latitude, altitude: targetGeo.altitude, crs: 'EPSG:4326' } : null,
            minDistance: view.controls?.minDistance ?? null,
            maxDistance: view.controls?.maxDistance ?? null,
            zoomFactor: view.controls?.zoomFactor ?? null,
            enableDamping: view.controls?.enableDamping ?? null,
        };
    }

    function stencilCenterToGeo(center) {
        if (!center) return null;
        const coord = new itowns.Coordinates(view.referenceCrs, center.x, center.y, center.z);
        const geo = coord.as('EPSG:4326');
        return { longitude: geo.longitude, latitude: geo.latitude, altitude: geo.altitude, crs: 'EPSG:4326' };
    }

    function buildUserConfigSnapshot() {
        const controls = serializeControls();
        const placement = controls?.targetGeo ? {
            coord: controls.targetGeo,
            range: controls.range,
            tilt: controls.tilt,
            heading: controls.heading,
        } : null;
        return {
            version: 1,
            sources: view?.userData?.sources ?? null,
            view: {
                placement,
                controls,
                camera: serializeCamera(),
            },
            globes: {
                runtimeSnapshot: true,
                transforms: {
                    context: serializeObject3D(contextObject3D),
                    origin: serializeObject3D(originObject3D),
                    destination: serializeObject3D(destinationObject3D),
                },
            },
            scale: globeScaleState.value,
            contextMode: { enabled: contextModeState.enabled },
            stencils: {
                origin: {
                    centerECEF: serializeVector3(stencil1.uniforms?.uStencilCenter?.value),
                    centerGeo: stencilCenterToGeo(stencil1.uniforms?.uStencilCenter?.value),
                    radiusMeters: stencil1.uniforms?.uStencilRadius?.value ?? null,
                    opacity: stencil1.cylinder?.mesh?.material?.opacity ?? null,
                    stencilEnabled: stencil1.uniforms?.uStencilEnabled?.value ?? null,
                    cylinderVisible: stencil1.cylinder?.mesh?.visible ?? null,
                },
                destination: {
                    centerECEF: serializeVector3(stencil2.uniforms?.uStencilCenter?.value),
                    centerGeo: stencilCenterToGeo(stencil2.uniforms?.uStencilCenter?.value),
                    radiusMeters: stencil2.uniforms?.uStencilRadius?.value ?? null,
                    opacity: stencil2.cylinder?.mesh?.material?.opacity ?? null,
                    stencilEnabled: stencil2.uniforms?.uStencilEnabled?.value ?? null,
                    cylinderVisible: stencil2.cylinder?.mesh?.visible ?? null,
                },
                context: {
                    deriveCenterFromTargets: true,
                    radiusMeters: stencil3.uniforms?.uStencilRadius?.value ?? null,
                    opacity: stencil3.cylinder?.mesh?.material?.opacity ?? null,
                    stencilEnabled: stencil3.uniforms?.uStencilEnabled?.value ?? null,
                    cylinderVisible: stencil3.cylinder?.mesh?.visible ?? null,
                },
            },
            xr: {
                immersivePlacement: { ...xrImmersivePlacementState.config },
            },
        };
    }

    function buildDebugSnapshot() {
        return {
            version: 1,
            createdAt: new Date().toISOString(),
            referenceCrs: view.referenceCrs,
            scale: globeScaleState.value,
            scaleSlider01: slider01FromScale(globeScaleState.value),
            camera: serializeCamera(),
            controls: serializeControls(),
            globes: {
                context: serializeObject3D(contextObject3D),
                origin: serializeObject3D(originObject3D),
                destination: serializeObject3D(destinationObject3D),
            },
            stencils: {
                origin: serializeObject3D(stencil1?.cylinder?.mesh),
                destination: serializeObject3D(stencil2?.cylinder?.mesh),
                context: serializeObject3D(stencil3?.cylinder?.mesh),
            },
            contextMode: { ...contextModeState },
            verticalAlign: { ...verticalAlignState },
            cylinderAlign: { ...cylinderAlignState },
            counterRotationAngleRad: counterRotationState.angleRad,
        };
    }

    function dumpConfigSnapshot() {
        const snapshot = buildUserConfigSnapshot();
        console.log('[itowns-xr] config snapshot', snapshot);
        console.log('[itowns-xr] config snapshot JSON:', JSON.stringify(snapshot, null, 2));
        return snapshot;
    }

    let counterDebugTimer = null;

    function getCounterRotationDiagnostics() {
        const solved = computeDesiredCounterRotation();
        if (!solved) return null;
        const { targetBearing, positionBearing, desired } = solved;
        const delta = normalizeAngleRad(desired - counterRotationState.angleRad);
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        const p1Context = (p1 && originObject3D && contextObject3D) ? mapCenterToGlobe(originObject3D, contextObject3D, p1) : null;
        const p2Context = (p2 && destinationObject3D && contextObject3D) ? mapCenterToGlobe(destinationObject3D, contextObject3D, p2) : null;
        return {
            targetBearing,
            positionBearing,
            desired,
            delta,
            angle: counterRotationState.angleRad,
            p1,
            p2,
            p1Context,
            p2Context,
            contextMode: contextModeState.enabled,
        };
    }

    function dumpCounterRotation() {
        const diag = getCounterRotationDiagnostics();
        if (!diag) return null;
        const {
            targetBearing,
            positionBearing,
            desired,
            delta,
            angle,
            p1,
            p2,
            p1Context,
            p2Context,
            contextMode,
        } = diag;
        const toDeg = (v) => (Number.isFinite(v) ? (v * 180) / Math.PI : v);
        console.log('[itowns-xr] counter-rotation', {
            targetBearingRad: targetBearing,
            targetBearingDeg: toDeg(targetBearing),
            positionBearingRad: positionBearing,
            positionBearingDeg: toDeg(positionBearing),
            desiredRad: desired,
            desiredDeg: toDeg(desired),
            deltaRad: delta,
            deltaDeg: toDeg(delta),
            currentAngleRad: angle,
            currentAngleDeg: toDeg(angle),
            contextMode,
            stencil1Center: p1 ? { x: p1.x, y: p1.y, z: p1.z } : null,
            stencil2Center: p2 ? { x: p2.x, y: p2.y, z: p2.z } : null,
            stencil1InContext: p1Context ? { x: p1Context.x, y: p1Context.y, z: p1Context.z } : null,
            stencil2InContext: p2Context ? { x: p2Context.x, y: p2Context.y, z: p2Context.z } : null,
        });
        return { targetBearing, positionBearing, desired, delta, angle };
    }

    function startCounterRotationWatch(intervalMs = 250) {
        const ms = Math.max(50, Number(intervalMs) || 250);
        if (counterDebugTimer) clearInterval(counterDebugTimer);
        counterDebugTimer = setInterval(() => {
            dumpCounterRotation();
        }, ms);
        console.log('[itowns-xr] counter watch started', { intervalMs: ms });
    }

    function stopCounterRotationWatch() {
        if (!counterDebugTimer) return;
        clearInterval(counterDebugTimer);
        counterDebugTimer = null;
        console.log('[itowns-xr] counter watch stopped');
    }

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

    function vectorFromCoord(coord) {
        const c = coordFromConfig(coord);
        if (!c) return null;
        const g = c.as(view.referenceCrs);
        return new THREE.Vector3(g.x, g.y, g.z);
    }

    function worldToGeoForGlobeTarget(world, globeRoot) {
        if (!world || !globeRoot) return null;
        globeRoot.updateMatrixWorld(true);
        const local = globeRoot.worldToLocal(world.clone());
        if (![local.x, local.y, local.z].every(Number.isFinite)) return null;
        const ref = new itowns.Coordinates(view.referenceCrs, local.x, local.y, local.z);
        const geo = ref.as('EPSG:4326');
        return {
            longitude: geo.longitude,
            latitude: geo.latitude,
            altitude: Number.isFinite(geo.altitude) ? geo.altitude : 0,
            crs: 'EPSG:4326',
        };
    }

    function geoToWorldForGlobeTarget(geo, globeRoot) {
        const localRef = vectorFromCoord(geo);
        if (!localRef || !globeRoot) return null;
        globeRoot.updateMatrixWorld(true);
        return globeRoot.localToWorld(localRef.clone());
    }

    function targetAlignmentErrorRad(globeRoot, desiredCenterWorld, targetGeo) {
        if (!globeRoot || !desiredCenterWorld || !targetGeo) return Number.POSITIVE_INFINITY;
        const desiredLocal = globeRoot.worldToLocal(desiredCenterWorld.clone());
        const targetLocal = vectorFromCoord(targetGeo);
        if (!targetLocal) return Number.POSITIVE_INFINITY;
        const a = desiredLocal.normalize();
        const b = targetLocal.normalize();
        if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return Number.POSITIVE_INFINITY;
        const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
        return Math.acos(dot);
    }

    function nextSavedViewName(name) {
        const trimmed = (typeof name === 'string' ? name.trim() : '');
        if (trimmed) return trimmed;
        return `View ${savedViewsState.entries.length + 1}`;
    }

    function saveCurrentTargetView(name) {
        if (!isGlobeInitialized) return null;
        const originCenter = stencil1.uniforms?.uStencilCenter?.value;
        const destinationCenter = stencil2.uniforms?.uStencilCenter?.value;
        const originTargetGeo = worldToGeoForGlobeTarget(originCenter, originObject3D);
        const destinationTargetGeo = worldToGeoForGlobeTarget(destinationCenter, destinationObject3D);
        if (!isValidGeoPoint(originTargetGeo) || !isValidGeoPoint(destinationTargetGeo)) return null;

        const nowIso = new Date().toISOString();
        const entry = normalizeSavedViewEntry({
            id: `sv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: nextSavedViewName(name),
            createdAt: nowIso,
            updatedAt: nowIso,
            scale: globeScaleState.value,
            originTargetGeo,
            destinationTargetGeo,
        }, 0);
        if (!entry) return null;

        savedViewsState.entries.unshift(entry);
        persistSavedViews();
        updateSavedViewsUi();
        savedViewsUi?.selectById?.(entry.id);
        return entry;
    }

    function applySavedTargetView(entryOrId) {
        if (!isGlobeInitialized) return false;
        const entry = typeof entryOrId === 'string'
            ? savedViewsState.entries.find((it) => it.id === entryOrId)
            : entryOrId;
        if (!entry) return false;

        const prevSuppress = suppressAutoAlignment;
        suppressAutoAlignment = true;
        const MAX_PASSES = 4;
        const TARGET_EPS = 1e-7;
        const COUNTER_EPS = 1e-7;
        try {
            if (Number.isFinite(entry.scale)) {
                applyGlobeScale(entry.scale);
            }

            for (let pass = 0; pass < MAX_PASSES; pass++) {
                const originTarget = geoToWorldForGlobeTarget(entry.originTargetGeo, originObject3D);
                const destinationTarget = geoToWorldForGlobeTarget(entry.destinationTargetGeo, destinationObject3D);
                if (!originTarget || !destinationTarget) return false;

                rotateRootToTargetAtStencil(originObject3D, stencil1.uniforms?.uStencilCenter?.value, originTarget);
                rotateRootToTargetAtStencil(destinationObject3D, stencil2.uniforms?.uStencilCenter?.value, destinationTarget);

                // Keep context center/quaternion derived, but skip auto vertical/cylinder alignment.
                updateGreenFromBlueRed();

                if (!contextModeState.enabled) {
                    counterRotationState.angleRad = 0;
                    applyCounterRotation({ maxIterations: 4, epsilon: 1e-9 });
                    // Re-sync context orientation after counter-rotation changed origin/destination.
                    updateGreenFromBlueRed();
                }

                const originErr = targetAlignmentErrorRad(originObject3D, stencil1.uniforms?.uStencilCenter?.value, entry.originTargetGeo);
                const destinationErr = targetAlignmentErrorRad(destinationObject3D, stencil2.uniforms?.uStencilCenter?.value, entry.destinationTargetGeo);
                const solved = contextModeState.enabled ? null : computeDesiredCounterRotation();
                const counterErr = solved ? Math.abs(normalizeAngleRad(solved.desired)) : 0;
                if (originErr <= TARGET_EPS && destinationErr <= TARGET_EPS && counterErr <= COUNTER_EPS) break;
            }
        } finally {
            suppressAutoAlignment = prevSuppress;
        }
        requestCameraRefresh({ frames: 22 });
        return true;
    }

    function deleteSavedTargetView(id) {
        const idx = savedViewsState.entries.findIndex((it) => it.id === id);
        if (idx < 0) return false;
        savedViewsState.entries.splice(idx, 1);
        persistSavedViews();
        updateSavedViewsUi();
        return true;
    }

    function setSliderValue(panel, selector, value) {
        const input = panel?.querySelector?.(selector);
        if (!input) return false;
        input.value = `${value}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function applyStencilConfig(stencil, baseScale, cfg) {
        if (!cfg || !stencil) return;
        const center = vectorFromCoord(cfg.centerECEF || cfg.centerGeo || cfg.targetECEF || cfg.targetGeo);
        if (center) {
            const root = stencil === stencil1 ? originObject3D
                : stencil === stencil2 ? destinationObject3D
                    : contextObject3D;
            const layer = stencil === stencil1 ? originLayer
                : stencil === stencil2 ? destinationLayer
                    : contextLayer;
            setStencilCenter(stencil, root, layer, center);
        }

        const radiusMeters = cfg.radiusMeters ?? cfg.viewRadiusMeters ?? cfg.cylinderRadiusMeters;
        if (Number.isFinite(radiusMeters)) {
            const baseRadius = radiusMeters / baseScale;
            const u = slider01FromRadius(baseRadius);
            stencil.radiusU = u;
            if (!setSliderValue(stencil.ui?.panel, `#${stencil.id}-r`, u)) {
                applyRadiusForStencil(stencil, baseScale, u);
            }
        }

        if (Number.isFinite(cfg.opacity)) {
            setSliderValue(stencil.ui?.panel, `#${stencil.id}-o`, cfg.opacity);
        }

        if (cfg.stencilEnabled !== undefined && stencil.ui?.setStencilEnabled) {
            stencil.ui.setStencilEnabled(!!cfg.stencilEnabled);
        }

        if (cfg.cylinderVisible !== undefined) {
            const visible = !!cfg.cylinderVisible;
            if (stencil === stencil1) {
                contextModeState.cyl1Visible = visible;
            } else if (stencil === stencil2) {
                contextModeState.cyl2Visible = visible;
            }
            if (contextModeState.enabled && (stencil === stencil1 || stencil === stencil2)) {
                stencil.cylinder.mesh.visible = false;
                if (stencil === stencil1) ghostBlue.mesh.visible = visible;
                if (stencil === stencil2) ghostRed.mesh.visible = visible;
            } else if (stencil === stencil3) {
                stencil.cylinder.mesh.visible = visible;
            } else {
                stencil.cylinder.mesh.visible = visible;
            }
            const btn = stencil.ui?.panel?.querySelector?.(`#${stencil.id}-vis`);
            if (btn) btn.textContent = visible ? 'Hide cyl' : 'Show cyl';
            updateContextCylinders();
            view.notifyChange(true);
        }
    }

    function applyGlobeTransformsConfig(cfg) {
        const transforms = cfg?.globes?.transforms;
        if (!transforms) return;
        if (transforms.context) applyObject3DTransform(contextObject3D, transforms.context);
        if (transforms.origin) applyObject3DTransform(originObject3D, transforms.origin);
        if (transforms.destination) applyObject3DTransform(destinationObject3D, transforms.destination);
    }

    function refreshBaseScales({ runtimeSnapshot = false, scale = null } = {}) {
        const sxOrigin = originObject3D?.scale?.x || 1;
        const sxDestination = destinationObject3D?.scale?.x || 1;
        const sxContext = contextObject3D?.scale?.x || 1;

        if (runtimeSnapshot && Number.isFinite(scale) && Math.abs(scale) > 1e-12) {
            // Runtime snapshots store transforms after the interactive global
            // scale was applied, so recover the base placement scale first.
            originScale = sxOrigin / scale;
            destinationScale = sxDestination / scale;
            contextScale = sxContext / scale;
        } else {
            originScale = sxOrigin;
            destinationScale = sxDestination;
            contextScale = sxContext;
        }
    }

    function applyConfigInternal(config) {
        if (!config) return;
        setXrImmersivePlacementConfig(config?.xr?.immersivePlacement, { applyNow: false });
        const stencilsCfg = config.stencils || {};
        const transformsAreRuntimeSnapshot = config?.globes?.runtimeSnapshot === true;
        const transformsCfg = config?.globes?.transforms;
        const hasSnapshotTransforms = !!(transformsCfg?.origin || transformsCfg?.destination || transformsCfg?.context);
        const scale = config.scale ?? config.view?.scale;
        const hasOriginTarget = !!(stencilsCfg.origin?.centerGeo || stencilsCfg.origin?.centerECEF || stencilsCfg.origin?.targetGeo || stencilsCfg.origin?.targetECEF);
        const hasDestinationTarget = !!(stencilsCfg.destination?.centerGeo || stencilsCfg.destination?.centerECEF || stencilsCfg.destination?.targetGeo || stencilsCfg.destination?.targetECEF);
        const contextIsDerived = (stencilsCfg.context?.deriveCenterFromTargets !== false) && (hasOriginTarget || hasDestinationTarget);
        const prevSuppress = suppressAutoAlignment;
        suppressAutoAlignment = true;
        try {
            applyGlobeTransformsConfig(config);
            refreshBaseScales({
                runtimeSnapshot: transformsAreRuntimeSnapshot && hasSnapshotTransforms,
                scale,
            });

            if (hasOriginTarget) {
                applyStencilConfig(stencil1, originScale, stencilsCfg.origin);
            }
            if (hasDestinationTarget) {
                applyStencilConfig(stencil2, destinationScale, stencilsCfg.destination);
            }

            if (contextIsDerived) {
                updateGreenFromBlueRed();
            } else if (stencilsCfg.context) {
                applyStencilConfig(stencil3, contextScale, stencilsCfg.context);
            }

            if (Number.isFinite(scale)) {
                if (transformsAreRuntimeSnapshot && hasSnapshotTransforms) {
                    globeScaleState.value = THREE.MathUtils.clamp(+scale || 1, SCALE_MIN, SCALE_MAX);
                    scaleUi?.setScale?.(globeScaleState.value);
                    applyAllStencilRadii();
                } else {
                    applyGlobeScale(scale);
                }
            } else {
                scaleUi?.setScale?.(globeScaleState.value);
            }

            if (stencilsCfg.origin) applyStencilConfig(stencil1, originScale, stencilsCfg.origin);
            if (stencilsCfg.destination) applyStencilConfig(stencil2, destinationScale, stencilsCfg.destination);
            if (!contextIsDerived && stencilsCfg.context) {
                applyStencilConfig(stencil3, contextScale, stencilsCfg.context);
            } else if (contextIsDerived && stencilsCfg.context) {
                // Keep context center derived from origin+destination targets but still apply visual settings.
                const { radiusMeters, viewRadiusMeters, cylinderRadiusMeters, opacity, stencilEnabled, cylinderVisible } = stencilsCfg.context;
                applyStencilConfig(stencil3, contextScale, {
                    radiusMeters,
                    viewRadiusMeters,
                    cylinderRadiusMeters,
                    opacity,
                    stencilEnabled,
                    cylinderVisible,
                });
            }

            if (config.contextMode?.enabled !== undefined) {
                setContextMode(!!config.contextMode.enabled);
            }
        } finally {
            suppressAutoAlignment = prevSuppress;
        }

        if (!contextModeState.enabled) {
            // Force a fresh solve after config load. Internal angle state is
            // not user-facing and can be stale across initialization paths.
            counterRotationState.angleRad = 0;
        }
        if (contextIsDerived) {
            updateGreenFromBlueRed();
        } else {
            if (!contextModeState.enabled) applyCounterRotation();
            updateContextCylinders();
            view.notifyChange(true);
        }
    }

    function applyConfig(config) {
        if (!config) return;
        if (!isGlobeInitialized) {
            pendingConfig = config;
            return;
        }
        applyConfigInternal(config);
    }

    window.__itownsDumpConfig = dumpConfigSnapshot;
    window.__itownsDumpDebugState = () => {
        const snapshot = buildDebugSnapshot();
        console.log('[itowns-xr] debug snapshot', snapshot);
        console.log('[itowns-xr] debug snapshot JSON:', JSON.stringify(snapshot, null, 2));
        return snapshot;
    };
    window.__itownsCounterRotationDebug = dumpCounterRotation;
    window.__itownsCounterRotationSample = getCounterRotationDiagnostics;
    window.__itownsCounterRotationWatch = startCounterRotationWatch;
    window.__itownsCounterRotationWatchStop = stopCounterRotationWatch;
    window.__itownsApplyConfig = applyConfig;
    window.__itownsSavedViewsList = () => savedViewsState.entries.slice();
    window.__itownsSavedViewsSave = (name = '') => saveCurrentTargetView(name);
    window.__itownsSavedViewsApply = (id) => applySavedTargetView(id);
    window.__itownsSavedViewsDelete = (id) => deleteSavedTargetView(id);
    window.__itownsSetXrPlacement = (cfg = {}, applyNow = false) =>
        setXrImmersivePlacementConfig(cfg, { applyNow: !!applyNow });
    window.__itownsGetXrPlacement = () => ({ ...xrImmersivePlacementState.config });
    window.__itownsDumpXrPlacementDebug = dumpXrPlacementDebug;
    attachDumpControls({
        panel: stencil3.ui.panel,
        onDump: dumpConfigSnapshot,
        anchorSelector: 'input[type="range"]',
    });
    savedViewsUi = attachSavedViewsControls({
        panel: stencil3.ui.panel,
        initialItems: savedViewsState.entries,
        anchorSelector: null,
        onSave: (name) => {
            saveCurrentTargetView(name);
        },
        onApply: (id) => {
            applySavedTargetView(id);
        },
        onDelete: (id) => {
            deleteSavedTargetView(id);
        },
    });
    updateSavedViewsUi();

    function getLookAtECEF() {
        const c = view.controls.getLookAtCoordinate();
        const g = c.as(view.referenceCrs);
        return new THREE.Vector3(g.x, g.y, g.z);
    }

    // Reposition via picking (works for both globes; you choose which stencil is armed)
    viewerDiv.addEventListener('click', (event) => {
        if (!stencil1.picking && !stencil2.picking && !stencil1.rotating && !stencil2.rotating) return;

        const picked = getPickedContext(event);
        if (picked) {
            if (stencil1.picking) {
                repositionMaskWithRotation({ stencil: stencil1, targetWorld: picked, globeRoot: originObject3D });
            }
            if (stencil2.picking) {
                repositionMaskWithRotation({ stencil: stencil2, targetWorld: picked, globeRoot: destinationObject3D });
            }
            if (stencil2.rotating) {
                const target = mapFromContext(picked, destinationObject3D);
                rotateGlobe2ToTarget(target);
                stencil2.rotating = false;
                stencil2.ui.setRotateMode(false);
                if (contextModePrev.active && contextModePrev.owner === stencil2.id) {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                    setContextMode(false);
                }
            }
            if (stencil1.rotating) {
                const target = mapFromContext(picked, originObject3D);
                rotateGlobe1ToTarget(target);
                stencil1.rotating = false;
                stencil1.ui.setRotateMode(false);
                if (contextModePrev.active && contextModePrev.owner === stencil1.id) {
                    contextModePrev.active = false;
                    contextModePrev.owner = null;
                    setContextMode(false);
                }
            }
            if (stencil1.picking || stencil2.picking) updateGreenFromBlueRed();
        }

        if (stencil1.picking) { stencil1.picking = false; stencil1.ui.setPicking(false); }
        if (stencil2.picking) { stencil2.picking = false; stencil2.ui.setPicking(false); }
        // Only clear rotate mode when a pick happened; if no pick, keep it armed
        // but if we reach here rotation was resolved above.
    });

    // Patch before render every frame to avoid flicker and to keep up with new tiles
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        const newly1 = patchMeshesUnderRoot({
            root: stencil1.patchRoot(),
            stencilId: stencil1.id,
            uniforms: stencil1.uniforms,
            state: stencil1.state,
        });

        const newly2 = patchMeshesUnderRoot({
            root: stencil2.patchRoot(),
            stencilId: stencil2.id,
            uniforms: stencil2.uniforms,
            state: stencil2.state,
        });

        const newly3 = patchMeshesUnderRoot({
            root: stencil3.patchRoot(),
            stencilId: stencil3.id,
            uniforms: stencil3.uniforms,
            state: stencil3.state,
        });

        if (newly1 > 0 && stencil1.ui.status) stencil1.ui.status.textContent = `Patched tile materials: ${stencil1.state.count}`;
        if (newly2 > 0 && stencil2.ui.status) stencil2.ui.status.textContent = `Patched tile materials: ${stencil2.state.count}`;
        if (newly3 > 0 && stencil3.ui.status) stencil3.ui.status.textContent = `Patched tile materials: ${stencil3.state.count}`;
    });

    // Initialize once globe is ready
    view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, () => {
        if (didInitialize) return;
        didInitialize = true;
        isGlobeInitialized = true;
        initStencilCenters();
        // One-time cylinder alignment so centers share a common height baseline.
        alignCylindersToRadius('context');

        // immediate patch pass
        patchMeshesUnderRoot({ root: stencil1.patchRoot(), stencilId: stencil1.id, uniforms: stencil1.uniforms, state: stencil1.state });
        patchMeshesUnderRoot({ root: stencil2.patchRoot(), stencilId: stencil2.id, uniforms: stencil2.uniforms, state: stencil2.state });
        patchMeshesUnderRoot({ root: stencil3.patchRoot(), stencilId: stencil3.id, uniforms: stencil3.uniforms, state: stencil3.state });

        if (stencil1.ui.status) stencil1.ui.status.textContent = `Patched tile materials: ${stencil1.state.count}`;
        if (stencil2.ui.status) stencil2.ui.status.textContent = `Patched tile materials: ${stencil2.state.count}`;
        if (stencil3.ui.status) stencil3.ui.status.textContent = `Patched tile materials: ${stencil3.state.count}`;

        if (pendingConfig) {
            const cfg = pendingConfig;
            pendingConfig = null;
            applyConfigInternal(cfg);
        }

        if (xrImmersivePlacementState.pendingStart && view?.renderer?.xr?.isPresenting) {
            scheduleXRSessionStartPlacement();
        }

        view.notifyChange(true);
    });

    return {
        stencil1,
        stencil2,
        stencil3,
        contextModeState,
        applyConfig,
        onXRSessionStart: scheduleXRSessionStartPlacement,
        onXRSessionEnd,
        setXrImmersivePlacementConfig,
        getXrImmersivePlacementConfig: () => ({ ...xrImmersivePlacementState.config }),
        dumpXrPlacementDebug,
    };
}
