import * as itowns from 'itowns';
import * as THREE from 'three';
import { createStencilUniforms, makeGhostCylinder, makeStencilCylinder } from './cylinders.js';
import { patchMeshesUnderRoot, logMaterialsForRoot } from './patching.js';
import { createStencilWidget, radiusFromSlider01, UI_BUTTON_STYLE } from './ui.js';

export function setupStencilSystem({ view, viewerDiv, contextRoot, originObject3D, destinationObject3D }) {
    const contextObject3D = contextRoot || view?.tileLayer?.object3d || view?.scene;
    const originScale = originObject3D?.scale?.x || 1;
    const destinationScale = destinationObject3D?.scale?.x || 1;
    const contextScale = contextObject3D?.scale?.x || 1;
    const pickRaycaster = new THREE.Raycaster();
    const pickNdc = new THREE.Vector2();
    const pickEllipsoid = new itowns.Ellipsoid();
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
    const axisTmp = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const axisQuat = new THREE.Quaternion();
    const contextModeState = {
        enabled: false,
        globe1Visible: true,
        globe2Visible: true,
        cyl1Visible: true,
        cyl2Visible: true,
        stencil3Enabled: true,
    };

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

    function setStencilCenter(stencil, globeRoot, position) {
        stencil.cylinder.setCenterECEF(position);
        updateAxisForCenter(stencil.uniforms.uStencilCenter.value, globeRoot, stencil.uniforms, stencil.cylinder.mesh);
    }

    function setGhostCenter(ghost, globeRoot, position) {
        ghost.setCenterECEF(position);
        updateAxisForCenter(position, globeRoot, null, ghost.mesh);
    }

    function computeBearingInContext(p1World, p2World) {
        if (!p1World || !p2World) return 0;
        const p1Local = contextObject3D.worldToLocal(p1World.clone());
        const p2Local = contextObject3D.worldToLocal(p2World.clone());
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

    function scaleFromSlider01(u) {
        const min = 0.05;
        const max = 5.0;
        const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
        return min * Math.pow(max / min, clamped);
    }

    function updateRadiusLabelForScale(panel, idPrefix, baseScale) {
        const input = panel.querySelector(`#${idPrefix}-radius`);
        const label = panel.querySelector(`#${idPrefix}-radius-value`);
        if (!input || !label) return;
        const u = parseFloat(input.value);
        if (!Number.isFinite(u)) return;
        const radius = radiusFromSlider01(u) * baseScale / globeScaleState.value;
        label.textContent = `${radius.toFixed(0)} m`;
    }

    function updateAllRadiusLabels() {
        if (stencil1.ui?.panel) updateRadiusLabelForScale(stencil1.ui.panel, stencil1.id, originScale);
        if (stencil2.ui?.panel) updateRadiusLabelForScale(stencil2.ui.panel, stencil2.id, destinationScale);
        if (stencil3.ui?.panel) updateRadiusLabelForScale(stencil3.ui.panel, stencil3.id, contextScale);
    }

    function projectToScreen(worldPos) {
        const ndc = worldPos.clone().project(view.camera3D);
        const width = view.camera?.width || view.mainLoop?.gfxEngine?.width || viewerDiv.clientWidth;
        const height = view.camera?.height || view.mainLoop?.gfxEngine?.height || viewerDiv.clientHeight;
        return new THREE.Vector2(
            (ndc.x + 1) * 0.5 * width,
            (-ndc.y + 1) * 0.5 * height,
        );
    }

    function computePositionBearing() {
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (!p1 || !p2) return 0;
        const s1 = projectToScreen(p1);
        const s2 = projectToScreen(p2);
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        if (dx * dx + dy * dy < 1e-6) return 0;
        return Math.atan2(dy, dx);
    }

    function computeTargetBearing() {
        const p1 = stencil1.uniforms.uStencilCenter.value;
        const p2 = stencil2.uniforms.uStencilCenter.value;
        if (!p1 || !p2) return 0;
        const p1Context = mapCenterToGlobe(originObject3D, contextObject3D, p1);
        const p2Context = mapCenterToGlobe(destinationObject3D, contextObject3D, p2);
        return computeBearingInContext(p1Context, p2Context);
    }

    function rotateAroundPoint(obj, point, axis, angle) {
        if (!obj) return;
        if (axis.lengthSq() < 1e-8 || Math.abs(angle) < 1e-8) return;
        const q = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle);
        obj.position.sub(point);
        obj.position.applyQuaternion(q);
        obj.position.add(point);
        obj.quaternion.premultiply(q);
        obj.updateMatrixWorld(true);
    }

    function rotateGlobeAroundStencil(globeRoot, center, angle) {
        if (!globeRoot || !center) return;
        const axis = center.clone().sub(globeRoot.position).normalize();
        rotateAroundPoint(globeRoot, center.clone(), axis, angle);
    }

    function scaleAroundPoint(obj, point, factor) {
        if (!obj || !point || !Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
        obj.position.sub(point);
        obj.position.multiplyScalar(factor);
        obj.position.add(point);
        obj.scale.multiplyScalar(factor);
        obj.updateMatrixWorld(true);
    }

    function applyGlobeScale(nextScale) {
        const clamped = Math.max(0.01, +nextScale || 1);
        const factor = clamped / globeScaleState.value;
        if (Math.abs(factor - 1) < 1e-6) return;
        globeScaleState.value = clamped;
        scaleAroundPoint(originObject3D, stencil1.uniforms.uStencilCenter.value, factor);
        scaleAroundPoint(destinationObject3D, stencil2.uniforms.uStencilCenter.value, factor);
        scaleAroundPoint(contextObject3D, stencil3.uniforms.uStencilCenter.value, factor);
        updateAxisForCenter(stencil1.uniforms.uStencilCenter.value, originObject3D, stencil1.uniforms, stencil1.cylinder.mesh);
        updateAxisForCenter(stencil2.uniforms.uStencilCenter.value, destinationObject3D, stencil2.uniforms, stencil2.cylinder.mesh);
        updateAxisForCenter(stencil3.uniforms.uStencilCenter.value, contextObject3D, stencil3.uniforms, stencil3.cylinder.mesh);
        if (contextModeState.enabled) {
            updateAxisForCenter(ghostBlue.mesh.position, contextObject3D, null, ghostBlue.mesh);
            updateAxisForCenter(ghostRed.mesh.position, contextObject3D, null, ghostRed.mesh);
        }
        updateGreenFromBlueRed();
        updateAllRadiusLabels();
        view.notifyChange(true);
    }

    function applyCounterRotation() {
        if (contextModeState.enabled) return;
        const targetBearing = computeTargetBearing();
        const positionBearing = computePositionBearing();
        const desired = -(targetBearing + positionBearing);
        const delta = desired - counterRotationState.angleRad;
        if (Math.abs(delta) < 1e-6) return;
        rotateGlobeAroundStencil(originObject3D, stencil1.uniforms.uStencilCenter.value, delta);
        rotateGlobeAroundStencil(destinationObject3D, stencil2.uniforms.uStencilCenter.value, delta);
        counterRotationState.angleRad = desired;
        view.notifyChange(true);
    }

    function clearCounterRotation() {
        if (Math.abs(counterRotationState.angleRad) < 1e-6) return;
        const delta = -counterRotationState.angleRad;
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
        const hit = pickEllipsoid.intersection(pickRaycaster.ray);
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

        const baseRadius1 = stencil1.uniforms.uStencilRadius.value / originScale;
        const baseRadius2 = stencil2.uniforms.uStencilRadius.value / destinationScale;
        ghostBlue.setRadiusMeters(baseRadius1 * contextScale);
        ghostRed.setRadiusMeters(baseRadius2 * contextScale);
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
        setStencilCenter(stencil3, contextObject3D, mid);

        const q1 = originObject3D ? originObject3D.quaternion : identityQuat;
        tempQuat.copy(q1).slerp(destinationObject3D.quaternion, 0.5);
        contextObject3D.quaternion.copy(tempQuat);
        contextObject3D.updateMatrixWorld(true);

        if (!contextModeState.enabled) {
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
        setStencilCenter(stencil1, originObject3D, p1);
        setStencilCenter(stencil2, destinationObject3D, p2);

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
        const desired = stencil2.uniforms.uStencilCenter.value;
        if (!desired) return;
        const center = new THREE.Vector3();
        destinationObject3D.getWorldPosition(center);
        const tDir = targetECEF.clone().sub(center).normalize();
        const dDir = desired.clone().sub(center).normalize();
        if (tDir.lengthSq() < 1e-6 || dDir.lengthSq() < 1e-6) return;

        const q = new THREE.Quaternion().setFromUnitVectors(tDir, dDir);
        destinationObject3D.quaternion.premultiply(q);
        destinationObject3D.updateMatrixWorld(true);
        view.notifyChange(true);
        updateGreenFromBlueRed();
    }

    function rotateGlobe1ToTarget(targetECEF) {
        const desired = stencil1.uniforms.uStencilCenter.value;
        if (!desired || !originObject3D) return;
        const center = new THREE.Vector3();
        originObject3D.getWorldPosition(center);
        const tDir = targetECEF.clone().sub(center).normalize();
        const dDir = desired.clone().sub(center).normalize();
        if (tDir.lengthSq() < 1e-6 || dDir.lengthSq() < 1e-6) return;

        const q = new THREE.Quaternion().setFromUnitVectors(tDir, dDir);
        originObject3D.quaternion.premultiply(q);
        originObject3D.updateMatrixWorld(true);
        view.notifyChange(true);
        updateGreenFromBlueRed();
    }

    function repositionMaskWithRotation({ stencil, targetWorld, globeRoot }) {
        const desired = stencil.uniforms.uStencilCenter.value;
        if (!desired || !targetWorld) return;
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
        setStencilCenter(stencil, globeRoot, targetWorld);
    }

    function centerCylinderAtScreenCenter(stencil) {
        const gfx = view.mainLoop?.gfxEngine;
        const x = gfx?.width ? gfx.width * 0.5 : viewerDiv.clientWidth * 0.5;
        const y = gfx?.height ? gfx.height * 0.5 : viewerDiv.clientHeight * 0.5;
        const picked = pickContextAt({ x, y });
        const targetContext = picked || getLookAtECEF();

        if (stencil === stencil2) {
            setStencilCenter(stencil2, destinationObject3D, targetContext);
        } else {
            setStencilCenter(stencil1, originObject3D, targetContext);
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
            stencil1.cylinder.setRadiusMeters(radiusFromSlider01(u) * originScale);
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
            stencil2.cylinder.setRadiusMeters(radiusFromSlider01(u) * destinationScale);
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
            stencil3.cylinder.setRadiusMeters(radiusFromSlider01(u) * contextScale);
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

    const scaleSeparator = document.createElement('div');
    scaleSeparator.style.cssText = 'height:1px;background:rgba(255,255,255,0.12);margin:6px 0;';
    const scaleRow = document.createElement('div');
    scaleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = 'Scale';
    const scaleValue = document.createElement('span');
    scaleValue.textContent = '1.00x';
    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleValue);

    const scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.min = '0';
    scaleInput.max = '1';
    scaleInput.step = '0.001';
    scaleInput.value = '0.5';
    scaleInput.style.width = '100%';

    const scaleWrap = document.createElement('div');
    scaleWrap.style.display = 'flex';
    scaleWrap.style.flexDirection = 'column';
    scaleWrap.style.gap = '6px';
    scaleWrap.appendChild(scaleRow);
    scaleWrap.appendChild(scaleInput);

    const contextBtn = document.createElement('button');
    contextBtn.id = `${stencil3.id}-context`;
    contextBtn.style.cssText = UI_BUTTON_STYLE;
    contextBtn.textContent = 'Context mode';
    const resetBtn = document.createElement('button');
    resetBtn.id = `${stencil3.id}-reset-globes`;
    resetBtn.style.cssText = UI_BUTTON_STYLE;
    resetBtn.textContent = 'Reset globes';
    const contextSliderAnchor = stencil3.ui.panel.querySelector('input[type="range"]')?.parentElement;
    if (contextSliderAnchor) {
        stencil3.ui.panel.insertBefore(contextBtn, contextSliderAnchor);
        stencil3.ui.panel.insertBefore(resetBtn, contextSliderAnchor);
    } else {
        stencil3.ui.panel.appendChild(contextBtn);
        stencil3.ui.panel.appendChild(resetBtn);
    }

    stencil3.ui.panel.appendChild(scaleSeparator);
    stencil3.ui.panel.appendChild(scaleWrap);

    const setContextButtonState = (enabled) => {
        contextBtn.classList.toggle('is-active', enabled);
        contextBtn.textContent = enabled ? 'Context mode on' : 'Context mode';
    };
    updateContextButton = setContextButtonState;
    contextBtn.addEventListener('click', () => {
        const next = !contextModeState.enabled;
        setContextMode(next);
        setContextButtonState(next);
    });
    resetBtn.addEventListener('click', () => {
        originObject3D.quaternion.copy(contextObject3D.quaternion);
        originObject3D.updateMatrixWorld(true);
        destinationObject3D.quaternion.copy(contextObject3D.quaternion);
        destinationObject3D.updateMatrixWorld(true);
        view.notifyChange(true);
        updateGreenFromBlueRed();
    });

    scaleInput.value = `${Math.log(globeScaleState.value / 0.05) / Math.log(5.0 / 0.05)}`;
    scaleInput.addEventListener('input', (e) => {
        const u = parseFloat(e.target.value);
        const scale = scaleFromSlider01(u);
        scaleValue.textContent = `${scale.toFixed(2)}x`;
        applyGlobeScale(scale);
    });
    updateAllRadiusLabels();

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
        initStencilCenters();

        // immediate patch pass
        patchMeshesUnderRoot({ root: stencil1.patchRoot(), stencilId: stencil1.id, uniforms: stencil1.uniforms, state: stencil1.state });
        patchMeshesUnderRoot({ root: stencil2.patchRoot(), stencilId: stencil2.id, uniforms: stencil2.uniforms, state: stencil2.state });
        patchMeshesUnderRoot({ root: stencil3.patchRoot(), stencilId: stencil3.id, uniforms: stencil3.uniforms, state: stencil3.state });

        if (stencil1.ui.status) stencil1.ui.status.textContent = `Patched tile materials: ${stencil1.state.count}`;
        if (stencil2.ui.status) stencil2.ui.status.textContent = `Patched tile materials: ${stencil2.state.count}`;
        if (stencil3.ui.status) stencil3.ui.status.textContent = `Patched tile materials: ${stencil3.state.count}`;

        view.notifyChange(true);
    });

    return { stencil1, stencil2, stencil3, contextModeState };
}
