import * as itowns from 'itowns';
import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';

// ---------- SETUP THE VR VIEW ----------

const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 15000,
    tilt: 80,
    heading: 0,
};

const viewerDiv = document.getElementById('viewerDiv');
const view = new itowns.GlobeView(viewerDiv, placement, {
    renderer: {
        alpha: true,
        antialias: true,
        logarithmicDepthBuffer: true,
    },
    webXR: { controllers: true },
});
view.renderer.xr.enabled = true;
const xrButton = XRButton.createButton(view.renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['dom-overlay', 'hit-test', 'depth-sensing'],
    domOverlay: { root: document.body },
    depthSensing: {
        usagePreference: ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
    },
});
viewerDiv.appendChild(xrButton);
disableAtmosphereEffects(view);
configureTransparentXR(view);

function disableAtmosphereEffects(view) {
    const atmosphere = view.getLayerById('atmosphere');
    if (atmosphere) {
        atmosphere.visible = false;
        if (typeof atmosphere.setRealisticOn === 'function') atmosphere.setRealisticOn(false);
        if (atmosphere.fog) atmosphere.fog.enable = false;
    }
    if (view.scene) {
        view.scene.background = null;
        if (view.scene.fog) view.scene.fog = null;
    }
    if (view.renderer) {
        view.renderer.setClearColor(0x000000, 0);
        view.renderer.domElement.style.background = 'transparent';
        const gl = view.renderer.getContext?.();
        if (gl?.canvas) gl.canvas.style.background = 'transparent';
    }
    if (view.mainLoop?.viewerDiv) {
        view.mainLoop.viewerDiv.style.background = 'transparent';
    }
    if (view.mainLoop?.gfxEngine?.renderer?.domElement) {
        view.mainLoop.gfxEngine.renderer.domElement.style.background = 'transparent';
    }
    if (view.mainLoop?.gfxEngine?.label2dRenderer?.domElement) {
        const labelCanvas = view.mainLoop.gfxEngine.label2dRenderer.domElement;
        labelCanvas.style.background = 'transparent';
        labelCanvas.style.pointerEvents = 'none';
    }
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
}

function configureTransparentXR(view) {
    const xr = view?.renderer?.xr;
    if (!xr || typeof XRWebGLLayer === 'undefined') return;

    const ensureTransparentLayer = () => {
        const session = xr.getSession?.();
        const gl = view.renderer.getContext?.();
        if (!session || !gl) return;

        const createLayer = () => {
            try {
                const baseLayer = new XRWebGLLayer(session, gl, {
                    alpha: true,
                    antialias: true,
                    depth: true,
                    stencil: true,
                });
                session.updateRenderState({ baseLayer });
            } catch (err) {
                console.warn('XR base layer setup failed', err);
            }
        };

        if (gl.makeXRCompatible) {
            gl.makeXRCompatible().then(createLayer).catch(createLayer);
        } else {
            createLayer();
        }
    };

    xr.addEventListener?.('sessionstart', ensureTransparentLayer);
    if (xr.isPresenting) ensureTransparentLayer();
}


// ---------- SOURCES (shared) ----------

const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
    zoom: { min: 0, max: 18 },
});

const elevationSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 0, max: 18 },
});

// ---------- GLOBE 1 (default globe in the GlobeView) ----------

view.addLayer(new itowns.ColorLayer('Ortho_globe1', { source: orthoSource }));
view.addLayer(new itowns.ElevationLayer('MNT_WORLD_globe1', { source: elevationSource }));

// ---------- GLOBE 2 (same View, second GlobeLayer placed next to the first) ----------
// Matches the approach from view_multiglobe.html (smaller globe offset on Y).

const globe2Object3D = new THREE.Object3D();
// globe2Object3D.scale.divideScalar(3);
// globe2Object3D.position.y = 10_000_000;
globe2Object3D.updateMatrixWorld(true);

const globe2 = new itowns.GlobeLayer('globe2', globe2Object3D);
globe2.diffuse = new THREE.Color(0xd0d5d8);

// Add globe2 so it gets updated by the view
itowns.View.prototype.addLayer.call(view, globe2);

// Add layers to globe2
itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_globe2', { source: orthoSource }), globe2);
itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_globe2', { source: elevationSource }), globe2);

// ---------- GLOBE 3 (same View, third GlobeLayer) ----------
const globe3Object3D = new THREE.Object3D();
globe3Object3D.updateMatrixWorld(true);

const globe3 = new itowns.GlobeLayer('globe3', globe3Object3D);
globe3.diffuse = new THREE.Color(0xd0d5d8);

// Add globe3 so it gets updated by the view
itowns.View.prototype.addLayer.call(view, globe3);

// Add layers to globe3
itowns.View.prototype.addLayer.call(view, new itowns.ColorLayer('Ortho_globe3', { source: orthoSource }), globe3);
itowns.View.prototype.addLayer.call(view, new itowns.ElevationLayer('MNT_WORLD_globe3', { source: elevationSource }), globe3);

// ============================================================================
// UI (styled like your previous file, now supports multiple instances)
// ============================================================================

const VIEW_RADIUS_MIN = 100;
const VIEW_RADIUS_MAX = 20000;

function radiusFromSlider01(u) {
    const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return VIEW_RADIUS_MIN * Math.pow(k, clamped);
}
function slider01FromRadius(rMeters) {
    const clamped = THREE.MathUtils.clamp(+rMeters || VIEW_RADIUS_MIN, VIEW_RADIUS_MIN, VIEW_RADIUS_MAX);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return Math.log(clamped / VIEW_RADIUS_MIN) / Math.log(k);
}

const PANEL_BASE_STYLE = {
    position: 'absolute',
    zIndex: 100,
    background: '#171b2833',
    border: '1px solid #2e344a',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    minWidth: '260px',
    maxWidth: '290px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
};

const UI_BUTTON_STYLE =
    'padding:7px 12px;border-radius:6px;background:transparent;color:inherit;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;cursor:pointer;';

const UI_STYLE_TAG_ID = 'itowns-stencil-ui-styles';

function applyPanelStyle(element, overrides = {}) {
    Object.assign(element.style, PANEL_BASE_STYLE, overrides);
}

function ensureUIPanelStyles() {
    if (document.getElementById(UI_STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = UI_STYLE_TAG_ID;
    style.textContent = `
    .itowns-ui-panel button {
      border: 1px solid #2e344a;
      background: rgba(58,61,79,0.45);
      color: #f4f7ff;
      transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .itowns-ui-panel button:hover { background: rgba(85, 101, 138, 0.7); border-color: #55618c; }
    .itowns-ui-panel button:active { background: #6573b5; border-color: #8797d5; }
    .itowns-ui-panel button.is-active {
      background: #5e6dd0;
      border-color: #8ea0ff;
      box-shadow: 0 0 12px rgba(102, 141, 255, 0.4);
      color: #fff;
    }
    .itowns-ui-panel input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.22);
      outline: none;
      cursor: pointer;
    }
    .itowns-ui-panel input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #8fb4ff;
      background: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      transition: transform 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-webkit-slider-thumb {
      transform: scale(1.08);
      border-color: #a7c6ff;
    }
  `;
    document.head.appendChild(style);
}

function createStencilWidget({
    idPrefix, title, panelPos,
    onTogglePick, onRadius01, onOpacity,
    onReset, onToggleCylinder,
    onToggleStencil,
    onToggleRotate,
    onResetGlobe,
    onLog,
    panelStyle = {},
    rotateButtonLabel,
    controls = {},
}) {
    ensureUIPanelStyles();

    const panel = document.createElement('div');
    applyPanelStyle(panel, { ...panelPos, ...panelStyle });
    panel.classList.add('itowns-ui-panel');

    const state = { radius: 1500, picking: false, opacity: 0.35 };

    const activeControls = {
        pick: true,
        center: true,
        log: true,
        stencil: true,
        rotate: true,
        resetGlobe: true,
        status: true,
        ...controls,
    };

    const pickId = `${idPrefix}-pick`;
    const rId = `${idPrefix}-r`;
    const rvId = `${idPrefix}-rv`;
    const oId = `${idPrefix}-o`;
    const ovId = `${idPrefix}-ov`;
    const statusId = `${idPrefix}-status`;

    const pickHtml = activeControls.pick
        ? `<button id="${pickId}" style="${UI_BUTTON_STYLE}">Reposition (click map)</button>`
        : '';
    const centerHtml = activeControls.center
        ? `<button id="${idPrefix}-reset" style="${UI_BUTTON_STYLE}">Center</button>`
        : '';
    const logHtml = activeControls.log
        ? `<button id="${idPrefix}-log" style="${UI_BUTTON_STYLE}">Log</button>`
        : '';
    const actionButtons = [centerHtml, `<button id="${idPrefix}-vis" style="${UI_BUTTON_STYLE}">Hide cyl</button>`, logHtml]
        .filter(Boolean)
        .join('\n');
    const actionRowHtml = `<div style="display:flex; gap:8px; flex-wrap:wrap;">${actionButtons}</div>`;
    const stencilHtml = activeControls.stencil
        ? `<button id="${idPrefix}-stencil" style="${UI_BUTTON_STYLE}; align-self:flex-start;">Disable stencil</button>`
        : '';
    const rotateRowHtml = rotateButtonLabel && (activeControls.rotate || activeControls.resetGlobe)
        ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">
      ${activeControls.rotate ? `<button id="${idPrefix}-rotate" style="${UI_BUTTON_STYLE};">${rotateButtonLabel}</button>` : ''}
      ${activeControls.resetGlobe ? `<button id="${idPrefix}-reset-globe" style="${UI_BUTTON_STYLE};">Reset globe</button>` : ''}
    </div>` : '';
    const statusHtml = activeControls.status
        ? `<div id="${statusId}" style="opacity:0.85;">Patched tile materials: 0</div>`
        : '';

    panel.innerHTML = `
    <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #555; padding-bottom:5px;">
      ${title}
    </div>

    ${pickHtml}

    ${actionRowHtml}

    ${stencilHtml}
    ${rotateRowHtml}

    <div style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Radius</span>
        <span id="${rvId}">${state.radius.toFixed(0)} m</span>
      </div>
      <input id="${rId}" type="range" min="0" max="1" step="0.001" value="${slider01FromRadius(state.radius)}">
    </div>

    <div style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Cylinder opacity</span>
        <span id="${ovId}">${state.opacity.toFixed(2)}</span>
      </div>
      <input id="${oId}" type="range" min="0" max="1" step="0.01" value="${state.opacity}">
    </div>

    ${statusHtml}
  `;

    document.body.appendChild(panel);

    const btnPick = panel.querySelector(`#${pickId}`);

    const btnReset = panel.querySelector(`#${idPrefix}-reset`);
    const btnVis = panel.querySelector(`#${idPrefix}-vis`);
    const btnLog = panel.querySelector(`#${idPrefix}-log`);
    const btnStencil = panel.querySelector(`#${idPrefix}-stencil`);
    const btnRotate = panel.querySelector(`#${idPrefix}-rotate`);
    const btnResetGlobe = panel.querySelector(`#${idPrefix}-reset-globe`);



    const radiusInput = panel.querySelector(`#${rId}`);
    const radiusLabel = panel.querySelector(`#${rvId}`);
    const opacityInput = panel.querySelector(`#${oId}`);
    const opacityLabel = panel.querySelector(`#${ovId}`);
    const status = panel.querySelector(`#${statusId}`);

    // Hard fail early if something is wrong (prevents silent null usage)
    const rotateControlsExpected = !!rotateButtonLabel;
    const required = [
        radiusInput && radiusLabel && opacityInput && opacityLabel,
        !activeControls.pick || btnPick,
        !activeControls.stencil || btnStencil,
        !activeControls.center || btnReset,
        !activeControls.log || btnLog,
        !rotateControlsExpected || !activeControls.rotate || btnRotate,
        !rotateControlsExpected || !activeControls.resetGlobe || btnResetGlobe,
        !activeControls.status || status,
    ];
    if (required.some((ok) => !ok)) throw new Error(`[UI] Missing element(s) for widget "${idPrefix}"`);

    const setPicking = (v) => {
        state.picking = !!v;
        if (btnPick) btnPick.classList.toggle('is-active', state.picking);
        onTogglePick?.(state.picking);
    };

    if (btnPick) btnPick.addEventListener('click', () => setPicking(!state.picking));

    radiusInput.addEventListener('input', (e) => {
        const u = parseFloat(e.target.value);
        state.radius = radiusFromSlider01(u);
        radiusLabel.textContent = `${state.radius.toFixed(0)} m`;
        onRadius01?.(u);
    });

    opacityInput.addEventListener('input', (e) => {
        state.opacity = parseFloat(e.target.value);
        opacityLabel.textContent = state.opacity.toFixed(2);
        onOpacity?.(state.opacity);
    });

    let cylVisible = true;
    let stencilEnabled = true;
    let rotateMode = false;


    if (btnReset) btnReset.addEventListener('click', () => onReset?.());
    if (btnLog) btnLog.addEventListener('click', () => onLog?.());

    if (btnVis) btnVis.addEventListener('click', () => {
        cylVisible = !cylVisible;
        btnVis.textContent = cylVisible ? 'Hide cyl' : 'Show cyl';
        onToggleCylinder?.(cylVisible);
    });

    const setStencilEnabled = (enabled) => {
        stencilEnabled = !!enabled;
        const disabled = !stencilEnabled;
        if (btnStencil) {
            btnStencil.classList.toggle('is-active', disabled);
            btnStencil.textContent = disabled ? 'Enable stencil' : 'Disable stencil';
        }
        onToggleStencil?.(stencilEnabled);
    };

    if (btnStencil) {
        btnStencil.addEventListener('click', () => {
            setStencilEnabled(!stencilEnabled);
        });
    }

    const setRotateMode = (v) => {
        rotateMode = !!v;
        if (btnRotate) btnRotate.classList.toggle('is-active', rotateMode);
        onToggleRotate?.(rotateMode);
    };
    if (btnRotate) btnRotate.addEventListener('click', () => setRotateMode(!rotateMode));
    if (btnResetGlobe) btnResetGlobe.addEventListener('click', () => onResetGlobe?.());

    const setStencilEnabledPublic = setStencilEnabled;
    const setRotateModePublic = setRotateMode;
    return { panel, status, setPicking, setStencilEnabled: setStencilEnabledPublic, setRotateMode: setRotateModePublic };
}

// ============================================================================
// Cylinder controller (per globe)
// - centered at picked point (extends equally up/down)
// - height proportional: "4× as wide as tall" => H = (2R)/4 = R/2
// ============================================================================

function createStencilUniforms(initialRadiusMeters) {
    return {
        uStencilCenter: { value: new THREE.Vector3() }, // world / EPSG:4978
        uStencilAxis: { value: new THREE.Vector3(0, 1, 0) }, // unit
        uStencilRadius: { value: initialRadiusMeters }, // meters (world)
        uStencilEnabled: { value: 1.0 }, // 0 = disabled, 1 = enabled
        uStencilDiscardOutside: { value: 1.0 }, // 0 = blend-to-diffuse outside, 1 = discard outside
    };
}

function makeStencilCylinder(view, uniforms, {
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
        depthTest: false,
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
            state.radius = Math.max(1, +r || 1);
            updateFromState();
        },
        setOpacity(a) {
            mesh.material.opacity = THREE.MathUtils.clamp(+a || 0, 0, 1);
            view.notifyChange(true);
        },
        update: updateFromState,
    };
}

// ============================================================================
// Shader patching (per globe)
// - patch tile materials under a root object3d
// - if a material is already patched for another globe, clone it per-mesh
// ============================================================================

function getOutputVar(fragmentShader) {
    if (fragmentShader.includes('gl_FragColor')) return 'gl_FragColor';
    const m1 = fragmentShader.match(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*out\s+vec4\s+(\w+)\s*;/);
    if (m1 && m1[1]) return m1[1];
    const m2 = fragmentShader.match(/\bout\s+vec4\s+(\w+)\s*;/);
    if (m2 && m2[1]) return m2[1];
    return null;
}

function insertAfterVersion(src, insert) {
    if (src.startsWith('#version')) {
        const nl = src.indexOf('\n');
        if (nl > 0) return src.slice(0, nl + 1) + insert + src.slice(nl + 1);
    }
    return insert + src;
}

function findMainCloseBrace(src) {
    const mainMatch = src.match(/\bvoid\s+main\s*\(\s*\)\s*\{/);
    if (!mainMatch) return -1;
    const start = src.indexOf(mainMatch[0]) + mainMatch[0].length - 1; // at '{'
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function patchLayeredMaterialInPlace(material, stencilId, uniforms) {
    if (!material || typeof material.fragmentShader !== 'string' || typeof material.vertexShader !== 'string') return false;

    // Already patched for this stencil
    if (material.userData?.__stencilPatchedFor === stencilId) {
        material.uniforms = material.uniforms || {};
        material.uniforms.uStencilCenter = uniforms.uStencilCenter;
        material.uniforms.uStencilAxis = uniforms.uStencilAxis;
        material.uniforms.uStencilRadius = uniforms.uStencilRadius;
        return true;
    }

    const outVar = getOutputVar(material.fragmentShader);
    if (!outVar) return false;

    // Vertex patch: add vWorldPos varying + assign before project_vertex
    if (!material.vertexShader.includes('varying vec3 vWorldPos')) {
        const vDecl = `\nvarying vec3 vWorldPos;\n`;
        let vs = insertAfterVersion(material.vertexShader, vDecl);

        if (vs.includes('#include <project_vertex>')) {
            vs = vs.replace(
                '#include <project_vertex>',
                `vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>`
            );
        } else {
            return false;
        }

        material.vertexShader = vs;
    }

    // Fragment patch: add uniforms/varying + inject mask at end of main (MODE_FINAL only)
    if (!material.fragmentShader.includes('uStencilCenter')) {
        const fDecl = `
uniform vec3  uStencilCenter;
uniform vec3  uStencilAxis;
uniform float uStencilRadius;
uniform float uStencilEnabled;
uniform float uStencilDiscardOutside;
varying vec3  vWorldPos;
`;
        let fs = insertAfterVersion(material.fragmentShader, fDecl);

        const close = findMainCloseBrace(fs);
        if (close < 0) return false;

        const hasDiffuse = /uniform\s+vec3\s+diffuse\s*;/.test(fs);
        const baseExpr = hasDiffuse ? 'vec3(diffuse)' : `${outVar}.rgb`;

        const inject = `
#if MODE == MODE_FINAL
  if (uStencilEnabled > 0.5) {
    vec3 _d = vWorldPos - uStencilCenter;
    float _h = dot(_d, uStencilAxis);
    vec3 _rad = _d - _h * uStencilAxis;
    float _r2 = dot(_rad, _rad);
    float _inside = step(_r2, uStencilRadius * uStencilRadius);
    if (uStencilDiscardOutside > 0.5) {
      if (_inside < 0.5) discard;
    } else {
      ${outVar}.rgb = mix(${baseExpr}, ${outVar}.rgb, _inside);
    }
  }
#endif
`.trim();

        fs = fs.slice(0, close) + '\n' + inject + '\n' + fs.slice(close);
        material.fragmentShader = fs;
    }

    material.uniforms = material.uniforms || {};
    material.uniforms.uStencilCenter = uniforms.uStencilCenter;
    material.uniforms.uStencilAxis = uniforms.uStencilAxis;
    material.uniforms.uStencilRadius = uniforms.uStencilRadius;
    material.uniforms.uStencilEnabled = uniforms.uStencilEnabled;
    material.uniforms.uStencilDiscardOutside = uniforms.uStencilDiscardOutside;

    material.userData = material.userData || {};
    material.userData.__stencilPatchedFor = stencilId;

    material.needsUpdate = true;
    if ('uniformsNeedUpdate' in material) material.uniformsNeedUpdate = true;
    return true;
}

function traverseMeshes(root, fn) {
    if (!root) return;
    root.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.material) return;
        fn(obj);
    });
}

function patchMeshesUnderRoot({ root, stencilId, uniforms, state }) {
    if (!root) return 0;
    let newlyPatched = 0;

    traverseMeshes(root, (mesh) => {
        const mat = mesh.material;
        if (!mat || typeof mat.fragmentShader !== 'string' || typeof mat.vertexShader !== 'string') return;

        // If material already patched for another stencil, clone it per-mesh
        const alreadyFor = mat.userData?.__stencilPatchedFor;
        if (alreadyFor && alreadyFor !== stencilId) {
            const cloned = mat.clone();
            cloned.uniforms = THREE.UniformsUtils.clone(mat.uniforms || {});
            cloned.userData = { ...(mat.userData || {}) };
            mesh.material = cloned;
        }

        const keyMat = mesh.material;
        if (state.patched.has(keyMat)) return;

        if (patchLayeredMaterialInPlace(keyMat, stencilId, uniforms)) {
            state.patched.add(keyMat);
            newlyPatched++;
            if (!keyMat.userData.__disposeHooked) {
                keyMat.addEventListener('dispose', () => {
                    if (state.patched.has(keyMat)) {
                        state.patched.delete(keyMat);
                        state.count = Math.max(0, state.count - 1);
                    }
                });
                keyMat.userData.__disposeHooked = true;
            }
        }

    });

    state.count += newlyPatched;
    return newlyPatched;
}

// ============================================================================
// Build three independent stencils (UI + cylinder + patching + picking)
// ============================================================================

const stencil1 = {
    id: 'g1',
    title: 'Camera Globe — Origin',
    panelPos: { left: '10px', top: '10px' },
    color: 0x2f8bff,
    uniforms: createStencilUniforms(1500.0),
    patchRoot: () => view?.tileLayer?.object3d || view?.scene, // fallback
    state: { patched: new WeakSet(), count: 0 },
    picking: false,
};

const globe2Scale = globe2Object3D.scale.x || 1;
const stencil2 = {
    id: 'g2',
    title: 'Target Globe — Destination',
    panelPos: { right: '10px', top: '10px' },
    color: 0xff3344,
    uniforms: createStencilUniforms(1500.0 * globe2Scale),
    patchRoot: () => globe2Object3D,
    state: { patched: new WeakSet(), count: 0 },
    picking: false,
    rotating: false,
};

const globe3Scale = globe3Object3D.scale.x || 1;
const stencil3 = {
    id: 'g3',
    title: 'Context Globe — In-between',
    panelPos: { left: '50%', top: '10px', transform: 'translateX(-50%)' },
    color: 0x2ecc71,
    uniforms: createStencilUniforms(1500.0 * globe3Scale),
    patchRoot: () => globe3Object3D,
    state: { patched: new WeakSet(), count: 0 },
    picking: false,
};

stencil1.cylinder = makeStencilCylinder(view, stencil1.uniforms, { radius: stencil1.uniforms.uStencilRadius.value, color: stencil1.color, opacity: 0.35 });
stencil2.cylinder = makeStencilCylinder(view, stencil2.uniforms, { radius: stencil2.uniforms.uStencilRadius.value, color: stencil2.color, opacity: 0.35 });
stencil3.cylinder = makeStencilCylinder(view, stencil3.uniforms, { radius: stencil3.uniforms.uStencilRadius.value, color: stencil3.color, opacity: 0.35 });

function makeGhostCylinder(view, {
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
        depthTest: false,
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
            state.radius = Math.max(1, +r || 1);
            updateFromState();
        },
        setOpacity(a) {
            mesh.material.opacity = THREE.MathUtils.clamp(+a || 0, 0, 1);
            view.notifyChange(true);
        },
        update: updateFromState,
    };
}

const identityQuat = new THREE.Quaternion();
const tempQuat = new THREE.Quaternion();
const ghostBlue = makeGhostCylinder(view, { radius: stencil1.uniforms.uStencilRadius.value, color: stencil1.color, opacity: 0.35 });
const ghostRed = makeGhostCylinder(view, { radius: stencil2.uniforms.uStencilRadius.value, color: stencil2.color, opacity: 0.35 });
const contextModeState = {
    enabled: false,
    globe1Visible: true,
    globe2Visible: true,
    cyl1Visible: true,
    cyl2Visible: true,
    stencil3Enabled: true,
};

function getGlobe1Root() {
    return view?.tileLayer?.object3d || null;
}

function mapCenterToGlobe(fromRoot, toRoot, position) {
    if (!fromRoot || !toRoot) return position.clone();
    fromRoot.updateMatrixWorld(true);
    toRoot.updateMatrixWorld(true);
    const local = fromRoot.worldToLocal(position.clone());
    return toRoot.localToWorld(local);
}

function updateContextCylinders() {
    if (!contextModeState.enabled) return;
    const p1 = stencil1.uniforms.uStencilCenter.value;
    const p2 = stencil2.uniforms.uStencilCenter.value;
    if (p1) ghostBlue.setCenterECEF(mapCenterToGlobe(getGlobe1Root(), globe3Object3D, p1));
    if (p2) ghostRed.setCenterECEF(mapCenterToGlobe(globe2Object3D, globe3Object3D, p2));

    const globe1Scale = getGlobe1Root()?.scale?.x || 1;
    const baseRadius1 = stencil1.uniforms.uStencilRadius.value / globe1Scale;
    const baseRadius2 = stencil2.uniforms.uStencilRadius.value / globe2Scale;
    ghostBlue.setRadiusMeters(baseRadius1 * globe3Scale);
    ghostRed.setRadiusMeters(baseRadius2 * globe3Scale);
    ghostBlue.setOpacity(stencil1.cylinder.mesh.material.opacity);
    ghostRed.setOpacity(stencil2.cylinder.mesh.material.opacity);
    ghostBlue.mesh.visible = contextModeState.cyl1Visible;
    ghostRed.mesh.visible = contextModeState.cyl2Visible;
}

function setContextMode(enabled) {
    contextModeState.enabled = !!enabled;
    const globe1Root = getGlobe1Root();
    if (contextModeState.enabled) {
        contextModeState.globe1Visible = globe1Root ? globe1Root.visible : true;
        contextModeState.globe2Visible = globe2Object3D.visible;
        contextModeState.cyl1Visible = stencil1.cylinder.mesh.visible;
        contextModeState.cyl2Visible = stencil2.cylinder.mesh.visible;
        contextModeState.stencil3Enabled = stencil3.uniforms.uStencilEnabled.value > 0.5;
        if (globe1Root) globe1Root.visible = false;
        globe2Object3D.visible = false;
        stencil1.cylinder.mesh.visible = false;
        stencil2.cylinder.mesh.visible = false;
        stencil3.ui.setStencilEnabled(false);
        ghostBlue.mesh.visible = contextModeState.cyl1Visible;
        ghostRed.mesh.visible = contextModeState.cyl2Visible;
        updateContextCylinders();
    } else {
        if (globe1Root) globe1Root.visible = contextModeState.globe1Visible;
        globe2Object3D.visible = contextModeState.globe2Visible;
        stencil1.cylinder.mesh.visible = contextModeState.cyl1Visible;
        stencil2.cylinder.mesh.visible = contextModeState.cyl2Visible;
        stencil3.ui.setStencilEnabled(contextModeState.stencil3Enabled);
        ghostBlue.mesh.visible = false;
        ghostRed.mesh.visible = false;
    }
    view.notifyChange(true);
}
function updateGreenFromBlueRed() {
    const p1 = stencil1.uniforms.uStencilCenter.value;
    const p2 = stencil2.uniforms.uStencilCenter.value;
    if (!p1 || !p2) return;
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    stencil3.cylinder.setCenterECEF(mid);

    tempQuat.slerpQuaternions(identityQuat, globe2Object3D.quaternion, 0.5);
    globe3Object3D.quaternion.copy(tempQuat);
    globe3Object3D.updateMatrixWorld(true);
    view.notifyChange(true);
    updateContextCylinders();
}

function initStencilCenters() {
    const c = view.controls.getLookAtCoordinate();
    const g = c.as(view.referenceCrs);
    const p1 = new THREE.Vector3(g.x, g.y, g.z);

    stencil1.cylinder.setCenterECEF(p1);

    // place stencil2 on globe2 at analogous location: p2 = pos + scale * p1
    const p2 = p1.clone().multiplyScalar(globe2Scale).add(globe2Object3D.position);
    stencil2.cylinder.setCenterECEF(p2);

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
    const tDir = targetECEF.clone().normalize();
    const dDir = desired.clone().normalize();
    if (tDir.lengthSq() < 1e-6 || dDir.lengthSq() < 1e-6) return;

    const q = new THREE.Quaternion().setFromUnitVectors(tDir, dDir);
    globe2Object3D.quaternion.premultiply(q);
    globe2Object3D.updateMatrixWorld(true);
    view.notifyChange(true);
    updateGreenFromBlueRed();
}

function centerCylinderAtScreenCenter(stencil) {
    const gfx = view.mainLoop?.gfxEngine;
    const x = gfx?.width ? gfx.width * 0.5 : viewerDiv.clientWidth * 0.5;
    const y = gfx?.height ? gfx.height * 0.5 : viewerDiv.clientHeight * 0.5;
    const picked = view.getPickingPositionFromDepth({ x, y });
    const target = picked || getLookAtECEF();

    if (stencil === stencil2) {
        const p2 = target.clone().multiplyScalar(globe2Scale).add(globe2Object3D.position);
        stencil2.cylinder.setCenterECEF(p2);
    } else {
        stencil1.cylinder.setCenterECEF(target);
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
        stencil1.ui.setStencilEnabled(!active);
    },
    onRadius01: (u) => {
        stencil1.cylinder.setRadiusMeters(radiusFromSlider01(u));
        updateContextCylinders();
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
});

stencil2.ui = createStencilWidget({
    idPrefix: stencil2.id,
    title: stencil2.title,
    panelPos: stencil2.panelPos,
    onTogglePick: (active) => {
        setExclusivePicking(stencil2, active);
        stencil2.ui.setStencilEnabled(!active);
    },
    onRadius01: (u) => {
        stencil2.cylinder.setRadiusMeters(radiusFromSlider01(u) * globe2Scale);
        updateContextCylinders();
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
            // Disable other pick modes for clarity
            stencil1.picking = false;
            stencil2.picking = false;
            stencil1.ui.setPicking(false);
            stencil2.ui.setPicking(false);
            // Turn stencil off while choosing a target
            stencil2.ui.setStencilEnabled(false);
        } else {
            stencil2.ui.setStencilEnabled(true);
        }
    },
    onResetGlobe: () => {
        globe2Object3D.quaternion.identity();
        globe2Object3D.updateMatrixWorld(true);
        view.notifyChange(true);
        updateGreenFromBlueRed();
    },
    onLog: () => logMaterialsForRoot(stencil2.patchRoot(), stencil2.id),
    panelStyle: { boxShadow: '0 14px 40px rgba(255, 51, 68, 0.45)', borderColor: '#ff334466' },
    rotateButtonLabel: 'Rotate target',
});

stencil3.ui = createStencilWidget({
    idPrefix: stencil3.id,
    title: stencil3.title,
    panelPos: stencil3.panelPos,
    onRadius01: (u) => stencil3.cylinder.setRadiusMeters(radiusFromSlider01(u) * globe3Scale),
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

const contextBtn = document.createElement('button');
contextBtn.id = `${stencil3.id}-context`;
contextBtn.style.cssText = UI_BUTTON_STYLE;
contextBtn.textContent = 'Context mode';
const contextSliderAnchor = stencil3.ui.panel.querySelector('input[type="range"]')?.parentElement;
if (contextSliderAnchor) {
    stencil3.ui.panel.insertBefore(contextBtn, contextSliderAnchor);
} else {
    stencil3.ui.panel.appendChild(contextBtn);
}

const setContextButtonState = (enabled) => {
    contextBtn.classList.toggle('is-active', enabled);
    contextBtn.textContent = enabled ? 'Context mode on' : 'Context mode';
};
contextBtn.addEventListener('click', () => {
    const next = !contextModeState.enabled;
    setContextMode(next);
    setContextButtonState(next);
});

function getLookAtECEF() {
    const c = view.controls.getLookAtCoordinate();
    const g = c.as(view.referenceCrs);
    return new THREE.Vector3(g.x, g.y, g.z);
}

function logMaterialsForRoot(root, label) {
    const mats = [];
    if (!root) return console.log(`[${label}] No root`);
    root.traverse((o) => {
        if (!o?.isMesh || !o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) if (m?.fragmentShader) mats.push(m);
    });
    const uniq = Array.from(new Set(mats));
    console.log(`[${label}] tile materials: ${uniq.length}`);
    uniq.slice(0, 25).forEach((m, i) => console.log(i, m));
}

// Reposition via picking (works for both globes; you choose which stencil is armed)
viewerDiv.addEventListener('click', (event) => {
    if (!stencil1.picking && !stencil2.picking && !stencil2.rotating) return;

    const picked = view.getPickingPositionFromDepth(view.eventToViewCoords(event));
    if (picked) {
        if (stencil1.picking) stencil1.cylinder.setCenterECEF(picked);
        if (stencil2.picking) stencil2.cylinder.setCenterECEF(picked);
        if (stencil2.rotating) {
            rotateGlobe2ToTarget(picked);
            stencil2.ui.setStencilEnabled(true);
            stencil2.rotating = false;
            stencil2.ui.setRotateMode(false);
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
