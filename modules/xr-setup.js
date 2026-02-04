import { XRButton } from 'three/addons/webxr/XRButton.js';

const DEFAULT_XR_OPTIONS = {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['dom-overlay', 'hit-test', 'depth-sensing'],
    domOverlay: { root: document.body },
    depthSensing: {
        usagePreference: ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
    },
};

export function attachXRButton(view, viewerDiv, options = {}) {
    if (!view?.renderer) return null;
    view.renderer.xr.enabled = true;

    const xrButton = XRButton.createButton(view.renderer, {
        ...DEFAULT_XR_OPTIONS,
        ...options,
    });

    if (viewerDiv && xrButton) viewerDiv.appendChild(xrButton);
    return xrButton;
}

export function configureTransparentXR(view) {
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
