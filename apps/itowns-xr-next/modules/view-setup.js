import * as itowns from 'itowns';
import { attachXRButton, configureTransparentXR } from './xr-setup.js';
import { disableAtmosphereEffects } from './view-effects.js';

export function createMainView(viewerDiv, placement) {
    const view = new itowns.GlobeView(viewerDiv, placement, {
        dynamicCameraNearFar: false,
        renderer: {
            alpha: true,
            antialias: true,
            logarithmicDepthBuffer: true,
        },
        webXR: { controllers: true },
    });

    attachXRButton(view, viewerDiv);

    disableAtmosphereEffects(view);
    configureTransparentXR(view);

    return view;
}
