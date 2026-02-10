import * as THREE from 'three';

const tmpCenter = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpAxisPoint = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

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

    // Vertex patch: add vWorldPos/vStencilLocalPos varyings + assign before project_vertex
    const needsWorldPos = !material.vertexShader.includes('varying vec3 vWorldPos');
    const needsLocalPos = !material.vertexShader.includes('varying vec3 vStencilLocalPos');
    if (needsWorldPos || needsLocalPos) {
        const vDecl = `\n${needsWorldPos ? 'varying vec3 vWorldPos;\n' : ''}${needsLocalPos ? 'varying vec3 vStencilLocalPos;\n' : ''}`;
        let vs = insertAfterVersion(material.vertexShader, vDecl);
        if (vs.includes('#include <project_vertex>')) {
            let inject = '';
            if (!vs.includes('vStencilLocalPos = transformed')) {
                inject += 'vStencilLocalPos = transformed;\n';
            }
            if (!vs.includes('vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz')) {
                inject += 'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n';
            }
            if (inject) {
                vs = vs.replace('#include <project_vertex>', `${inject}#include <project_vertex>`);
            }
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
uniform vec3  uStencilCenterLocal;
uniform vec3  uStencilAxisLocal;
uniform float uStencilRadiusLocal;
uniform float uStencilUseLocal;
uniform float uStencilEnabled;
uniform float uStencilDiscardOutside;
varying vec3  vWorldPos;
varying vec3  vStencilLocalPos;
`;
        let fs = insertAfterVersion(material.fragmentShader, fDecl);

        const close = findMainCloseBrace(fs);
        if (close < 0) return false;

        const hasDiffuse = /uniform\s+vec3\s+diffuse\s*;/.test(fs);
        const baseExpr = hasDiffuse ? 'vec3(diffuse)' : `${outVar}.rgb`;

        const inject = `
#if MODE == MODE_FINAL
  if (uStencilEnabled > 0.5) {
    vec3 _d = (uStencilUseLocal > 0.5) ? (vStencilLocalPos - uStencilCenterLocal) : (vWorldPos - uStencilCenter);
    vec3 _axis = (uStencilUseLocal > 0.5) ? uStencilAxisLocal : uStencilAxis;
    float _r = (uStencilUseLocal > 0.5) ? uStencilRadiusLocal : uStencilRadius;
    float _h = dot(_d, _axis);
    vec3 _rad = _d - _h * _axis;
    float _r2 = dot(_rad, _rad);
    float _inside = step(_r2, _r * _r);
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
    material.uniforms.uStencilCenterLocal = material.uniforms.uStencilCenterLocal || { value: new THREE.Vector3() };
    material.uniforms.uStencilAxisLocal = material.uniforms.uStencilAxisLocal || { value: new THREE.Vector3(0, 1, 0) };
    material.uniforms.uStencilRadiusLocal = material.uniforms.uStencilRadiusLocal || { value: uniforms.uStencilRadius.value };
    material.uniforms.uStencilUseLocal = material.uniforms.uStencilUseLocal || { value: 1.0 };

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
        if (state.patched.has(keyMat)) {
            updateLocalStencilUniforms(mesh, keyMat, uniforms);
            return;
        }

        if (patchLayeredMaterialInPlace(keyMat, stencilId, uniforms)) {
            state.patched.add(keyMat);
            newlyPatched++;
            updateLocalStencilUniforms(mesh, keyMat, uniforms);
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

function updateLocalStencilUniforms(mesh, material, uniforms) {
    if (!mesh || !material?.uniforms || !uniforms) return;
    const centerWorld = uniforms.uStencilCenter?.value;
    const axisWorld = uniforms.uStencilAxis?.value;
    const radiusWorld = uniforms.uStencilRadius?.value;
    if (!centerWorld || !axisWorld || !Number.isFinite(radiusWorld)) return;

    tmpCenter.copy(centerWorld);
    mesh.worldToLocal(tmpCenter);
    if (material.uniforms.uStencilCenterLocal) {
        material.uniforms.uStencilCenterLocal.value.copy(tmpCenter);
    }

    tmpAxisPoint.copy(centerWorld).add(axisWorld);
    mesh.worldToLocal(tmpAxisPoint);
    tmpAxis.copy(tmpAxisPoint).sub(tmpCenter);
    if (tmpAxis.lengthSq() < 1e-10) tmpAxis.set(0, 1, 0);
    else tmpAxis.normalize();
    if (material.uniforms.uStencilAxisLocal) {
        material.uniforms.uStencilAxisLocal.value.copy(tmpAxis);
    }

    mesh.getWorldScale(tmpScale);
    const scale = (tmpScale.x + tmpScale.y + tmpScale.z) / 3 || 1;
    if (material.uniforms.uStencilRadiusLocal) {
        material.uniforms.uStencilRadiusLocal.value = radiusWorld / scale;
    }
    if (material.uniforms.uStencilUseLocal) {
        material.uniforms.uStencilUseLocal.value = 1.0;
    }
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
