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

export function createSources(sourceConfig = {}) {
    const orthoOptions = { ...DEFAULT_ORTHO, ...(sourceConfig?.ortho || {}) };
    const elevationOptions = { ...DEFAULT_ELEVATION, ...(sourceConfig?.elevation || {}) };

    const orthoSource = new itowns.WMTSSource(orthoOptions);
    const elevationSource = new itowns.WMTSSource(elevationOptions);

    return { orthoSource, elevationSource, sourceOptions: { ortho: orthoOptions, elevation: elevationOptions } };
}
