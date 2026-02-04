import * as THREE from 'three';

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

export function patchMeshesUnderRoot({ root, stencilId, uniforms, state }) {
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

export function logMaterialsForRoot(root, label) {
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
