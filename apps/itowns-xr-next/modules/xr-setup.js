import { VRButton } from 'three/addons/webxr/VRButton.js';

const DEFAULT_XR_OPTIONS = {
    optionalFeatures: ['local-floor', 'bounded-floor'],
};

export function attachXRButton(view, viewerDiv, options = {}) {
    if (!view?.renderer) return null;
    view.renderer.xr.enabled = true;
    if (view.renderer.xr.setReferenceSpaceType) {
        // Keep XR reference space explicit and device-agnostic.
        view.renderer.xr.setReferenceSpaceType('local-floor');
    }

    const xrButton = VRButton.createButton(view.renderer, {
        ...DEFAULT_XR_OPTIONS,
        ...options,
    });

    if (viewerDiv && xrButton) viewerDiv.appendChild(xrButton);
    return xrButton;
}

export function configureTransparentXR(view) {
    // Intentionally no-op by default.
    // On real headsets, replacing baseLayer at session start can cause
    // inconsistent rendering/culling behavior with iTowns+three internals.
    void view;
}
