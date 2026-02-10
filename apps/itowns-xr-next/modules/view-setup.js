import * as itowns from 'itowns';
import { attachXRButton, configureTransparentXR } from './xr-setup.js';
import { disableAtmosphereEffects } from './view-effects.js';

export function createMainView(viewerDiv, placement) {
    const view = new itowns.GlobeView(viewerDiv, placement, {
        dynamicCameraNearFar: false,
        renderer: {
            alpha: true,
            antialias: true,
            // Keep depth picking precise for MOVE_GLOBE drag anchoring.
            // iTowns log-depth picking path is approximate and drifts at
            // tabletop scales.
            logarithmicDepthBuffer: false,
        },
        webXR: { controllers: true },
    });

    attachXRButton(view, viewerDiv);

    disableAtmosphereEffects(view);
    configureTransparentXR(view);

    return view;
}
