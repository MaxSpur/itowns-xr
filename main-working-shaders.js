import * as itowns from 'itowns';
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// ---------- SETUP THE VR VIEW ----------

const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 6.2, 45.167),
    range: 15000,
    tilt: 10,
    heading: 0,
};

const viewerDiv = document.getElementById('viewerDiv');

const view = new itowns.GlobeView(viewerDiv, placement, { webXR: { controllers: true } });

const vrButton = VRButton.createButton(view.renderer);
viewerDiv.appendChild(vrButton);

// ---------- ORTHO-IMAGERY LAYER ----------

const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
    zoom: { min: 0, max: 18 },
});

const orthoLayer1 = new itowns.ColorLayer('Ortho_globe1', { source: orthoSource });
view.addLayer(orthoLayer1);

// ---------- ELEVATION LAYER ----------

const elevationSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 0, max: 18 },
});

const elevationLayer1 = new itowns.ElevationLayer('MNT_WORLD', { source: elevationSource });
view.addLayer(elevationLayer1);

// ---------- UI (brightness + "shiny") ----------
// "Shiny" here is a debug-friendly rim/specular-ish term.
// If the shader exposes vNormal + vViewPosition, it becomes a fresnel rim.
// Otherwise it falls back to a small constant boost so you still see an effect.

const params = {
    brightness: 1.0, // 0..2
    shiny: 0.0,      // 0..1
};

function makeUI() {
    const ui = document.createElement('div');
    ui.style.position = 'absolute';
    ui.style.top = '10px';
    ui.style.left = '10px';
    ui.style.zIndex = '9999';
    ui.style.padding = '10px 12px';
    ui.style.background = 'rgba(0,0,0,0.65)';
    ui.style.color = '#fff';
    ui.style.font = '12px/1.25 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ui.style.borderRadius = '8px';
    ui.style.userSelect = 'none';
    ui.style.minWidth = '260px';

    const title = document.createElement('div');
    title.textContent = 'Tile shader debug';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    ui.appendChild(title);

    const status = document.createElement('div');
    status.style.opacity = '0.9';
    status.style.marginBottom = '8px';
    status.textContent = 'Patched materials: 0';
    ui.appendChild(status);

    function sliderRow(labelText, min, max, step, value) {
        const wrap = document.createElement('div');
        wrap.style.margin = '8px 0';

        const top = document.createElement('div');
        top.style.display = 'flex';
        top.style.justifyContent = 'space-between';
        top.style.alignItems = 'baseline';

        const label = document.createElement('div');
        label.textContent = labelText;

        const val = document.createElement('div');
        val.textContent = String(value);
        val.style.opacity = '0.9';

        top.appendChild(label);
        top.appendChild(val);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        input.style.width = '100%';

        wrap.appendChild(top);
        wrap.appendChild(input);

        return { wrap, input, val };
    }

    const b = sliderRow('Brightness', 0.0, 2.0, 0.01, params.brightness);
    const s = sliderRow('Shiny (debug)', 0.0, 1.0, 0.01, params.shiny);

    ui.appendChild(b.wrap);
    ui.appendChild(s.wrap);

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    buttons.style.marginTop = '10px';

    const repatchBtn = document.createElement('button');
    repatchBtn.textContent = 'Force repatch';
    repatchBtn.style.flex = '1';
    repatchBtn.style.cursor = 'pointer';

    const logBtn = document.createElement('button');
    logBtn.textContent = 'Log tile materials';
    logBtn.style.flex = '1';
    logBtn.style.cursor = 'pointer';

    buttons.appendChild(repatchBtn);
    buttons.appendChild(logBtn);
    ui.appendChild(buttons);

    document.body.appendChild(ui);

    return { status, b, s, repatchBtn, logBtn };
}

const ui = makeUI();

ui.b.input.addEventListener('input', () => {
    params.brightness = parseFloat(ui.b.input.value);
    ui.b.val.textContent = params.brightness.toFixed(2);
    updateAllPatchedUniforms();
    view.notifyChange();
});

ui.s.input.addEventListener('input', () => {
    params.shiny = parseFloat(ui.s.input.value);
    ui.s.val.textContent = params.shiny.toFixed(2);
    updateAllPatchedUniforms();
    view.notifyChange();
});

// ---------- SHADER PATCHING ----------
// Strategy:
// - Traverse tile meshes and patch ANY material that has a fragmentShader string.
// - Insert uniforms safely (after #version if present).
// - Inject post-color code at end of main() using the shader's output variable:
//   - gl_FragColor (WebGL1) OR a declared "out vec4 XXX;" (WebGL2 / GLSL3).

const patched = new WeakSet();
let patchedCount = 0;
let forceRepatch = false;

ui.repatchBtn.addEventListener('click', () => {
    forceRepatch = true;
    patchedCount = 0;
    ui.status.textContent = 'Patched materials: 0 (forcing...)';
    view.notifyChange();
});

ui.logBtn.addEventListener('click', () => {
    const mats = collectCandidateMaterials();
    console.log(`[iTowns] Candidate materials: ${mats.length}`);
    mats.slice(0, 10).forEach((m, i) => console.log(i, m));
});

function collectCandidateMaterials() {
    const mats = [];
    const root = view?.tileLayer?.object3d || view?.scene;
    if (!root) return mats;

    root.traverse((obj) => {
        if (!obj || !obj.material) return;

        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of list) {
            if (!m) continue;
            if (typeof m.fragmentShader === 'string' && m.fragmentShader.length > 0) {
                mats.push(m);
            }
        }
    });

    // De-dup by object identity
    return Array.from(new Set(mats));
}

function getOutputVar(fragmentShader) {
    if (fragmentShader.includes('gl_FragColor')) return 'gl_FragColor';

    // GLSL3 style: layout(location=0) out vec4 fragColor;
    const m1 = fragmentShader.match(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*out\s+vec4\s+(\w+)\s*;/);
    if (m1 && m1[1]) return m1[1];

    // GLSL3 style: out vec4 fragColor;
    const m2 = fragmentShader.match(/\bout\s+vec4\s+(\w+)\s*;/);
    if (m2 && m2[1]) return m2[1];

    return null;
}

function insertUniforms(fragmentShader) {
    const uniformBlock = `
uniform float uDebugBrightness;
uniform float uDebugShiny;
`;

    if (fragmentShader.includes('uDebugBrightness')) return fragmentShader;

    // Keep #version as the very first line if present
    if (fragmentShader.startsWith('#version')) {
        const nl = fragmentShader.indexOf('\n');
        if (nl > 0) {
            return fragmentShader.slice(0, nl + 1) + uniformBlock + fragmentShader.slice(nl + 1);
        }
    }

    // Otherwise safe prepend
    return uniformBlock + fragmentShader;
}

function findMainBlock(fragmentShader) {
    const mainMatch = fragmentShader.match(/\bvoid\s+main\s*\(\s*\)\s*\{/);
    if (!mainMatch) return null;

    const start = fragmentShader.indexOf(mainMatch[0]) + mainMatch[0].length - 1; // points at '{'
    let depth = 0;
    for (let i = start; i < fragmentShader.length; i++) {
        const c = fragmentShader[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                return { mainOpenBrace: start, mainCloseBrace: i };
            }
        }
    }
    return null;
}

function injectAtEndOfMain(fragmentShader, injectionCode) {
    const block = findMainBlock(fragmentShader);
    if (!block) return null;

    const { mainCloseBrace } = block;
    return fragmentShader.slice(0, mainCloseBrace) + '\n' + injectionCode + '\n' + fragmentShader.slice(mainCloseBrace);
}

function patchMaterial(m) {
    if (!m || typeof m.fragmentShader !== 'string') return false;
    if (!forceRepatch && patched.has(m)) return false;

    const outVar = getOutputVar(m.fragmentShader);
    if (!outVar) return false;

    let frag = m.fragmentShader;

    frag = insertUniforms(frag);

    const hasVNormal = /\b(varying|in)\s+vec3\s+vNormal\b/.test(frag) || /\bvNormal\b/.test(frag);
    const hasVViewPosition = /\b(varying|in)\s+vec3\s+vViewPosition\b/.test(frag) || /\bvViewPosition\b/.test(frag);

    const shinyCode = (hasVNormal && hasVViewPosition)
        ? `
/* debug: brightness + fresnel rim */
${outVar}.rgb *= uDebugBrightness;
vec3 _N = normalize(vNormal);
vec3 _V = normalize(-vViewPosition);
float _ndv = clamp(dot(_N, _V), 0.0, 1.0);
float _f = pow(1.0 - _ndv, 5.0);
${outVar}.rgb += _f * uDebugShiny;
`
        : `
/* debug: brightness + simple "shiny" boost (fallback) */
${outVar}.rgb *= uDebugBrightness;
${outVar}.rgb += vec3(0.15) * uDebugShiny;
`;

    // Avoid injecting twice
    if (frag.includes('debug: brightness')) {
        // still update uniforms below, but no code reinjection
    } else {
        const injected = injectAtEndOfMain(frag, shinyCode);
        if (!injected) return false;
        frag = injected;
        m.fragmentShader = frag;
    }

    // Ensure uniforms exist and are driven by UI
    m.uniforms = m.uniforms || {};
    m.uniforms.uDebugBrightness = m.uniforms.uDebugBrightness || { value: params.brightness };
    m.uniforms.uDebugShiny = m.uniforms.uDebugShiny || { value: params.shiny };

    // Mark for recompilation
    m.needsUpdate = true;
    if ('uniformsNeedUpdate' in m) m.uniformsNeedUpdate = true;

    patched.add(m);
    return true;
}

function updateAllPatchedUniforms() {
    const mats = collectCandidateMaterials();
    for (const m of mats) {
        if (!m || !m.uniforms) continue;
        if (m.uniforms.uDebugBrightness) m.uniforms.uDebugBrightness.value = params.brightness;
        if (m.uniforms.uDebugShiny) m.uniforms.uDebugShiny.value = params.shiny;
    }
}

function patchAllTileMaterialsOnce() {
    const mats = collectCandidateMaterials();
    let newlyPatched = 0;

    for (const m of mats) {
        if (patchMaterial(m)) newlyPatched++;
    }

    if (newlyPatched > 0) {
        patchedCount += newlyPatched;
        ui.status.textContent = `Patched materials: ${patchedCount}`;
        updateAllPatchedUniforms();
        view.notifyChange();
    }
}

// Keep trying while tiles/materials are still appearing.
let frame = 0;
view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.AFTER_RENDER, () => {
    frame++;

    // For the first few seconds, or if user forced it, keep scanning for new materials.
    if (frame < 300 || forceRepatch) {
        patchAllTileMaterialsOnce();
        if (forceRepatch && frame > 10) {
            // stop forcing after a short burst
            forceRepatch = false;
        }
    }

    // Uniforms can be updated at any time (cheap)
    updateAllPatchedUniforms();
});