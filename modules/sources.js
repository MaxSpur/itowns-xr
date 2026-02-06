import * as itowns from 'itowns';

const DEFAULT_ORTHO = {
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
    zoom: { min: 0, max: 18 },
};

const DEFAULT_ELEVATION = {
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 0, max: 18 },
};

function normalizeElevationOptions(options) {
    const out = {
        ...options,
        zoom: { ...(options?.zoom || {}) },
    };
    // GeoPF SRTM3 on WGS84G does not serve level 0 consistently and produces
    // noisy 404 bursts. Clamp to level 1+ while preserving user higher minima.
    if (out.tileMatrixSet === 'WGS84G' && /SRTM3/i.test(out.name || '')) {
        const min = Number.isFinite(out.zoom.min) ? out.zoom.min : 0;
        out.zoom.min = Math.max(1, min);
    }
    return out;
}

export function createSources(sourceConfig = {}) {
    const orthoOptions = { ...DEFAULT_ORTHO, ...(sourceConfig?.ortho || {}) };
    const elevationOptions = normalizeElevationOptions({ ...DEFAULT_ELEVATION, ...(sourceConfig?.elevation || {}) });

    const orthoSource = new itowns.WMTSSource(orthoOptions);
    const elevationSource = new itowns.WMTSSource(elevationOptions);

    return { orthoSource, elevationSource, sourceOptions: { ortho: orthoOptions, elevation: elevationOptions } };
}
