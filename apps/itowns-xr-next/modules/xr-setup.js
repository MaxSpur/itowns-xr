import { XRButton } from 'three/addons/webxr/XRButton.js';

const DEFAULT_XR_OPTIONS = {
    optionalFeatures: ['local-floor', 'bounded-floor'],
};

export function attachXRButton(view, viewerDiv, options = {}) {
    if (!view?.renderer) return null;
    view.renderer.xr.enabled = true;

    const mergedOptions = {
        ...DEFAULT_XR_OPTIONS,
        ...options,
    };
    mergedOptions.optionalFeatures = Array.from(new Set([
        ...(DEFAULT_XR_OPTIONS.optionalFeatures || []),
        ...(options.optionalFeatures || []),
    ]));

    const referenceSpaceType = mergedOptions.referenceSpaceType || 'local-floor';
    delete mergedOptions.referenceSpaceType;

    if (view.renderer.xr.setReferenceSpaceType) {
        // Keep XR reference space explicit and device-agnostic.
        view.renderer.xr.setReferenceSpaceType(referenceSpaceType);
    }

    // XRButton automatically prefers immersive-ar, then falls back to immersive-vr.
    const xrButton = XRButton.createButton(view.renderer, mergedOptions);

    if (viewerDiv && xrButton) viewerDiv.appendChild(xrButton);
    return xrButton;
}

export function configureTransparentXR(view) {
    // Intentionally no-op by default.
    // On real headsets, replacing baseLayer at session start can cause
    // inconsistent rendering/culling behavior with iTowns+three internals.
    void view;
}
