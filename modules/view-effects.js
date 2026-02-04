export function disableAtmosphereEffects(view) {
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
