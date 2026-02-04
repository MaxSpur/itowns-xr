import * as itowns from 'itowns';
import { XRButton } from 'three/addons/webxr/XRButton.js';

export function createMainView(viewerDiv, placement) {
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

    return view;
}

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
