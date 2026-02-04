import * as itowns from 'itowns';

export function createSources() {
    const orthoSource = new itowns.WMTSSource({
        url: 'https://data.geopf.fr/wmts?',
        crs: 'EPSG:3857',
        name: 'ORTHOIMAGERY.ORTHOPHOTOS',
        tileMatrixSet: 'PM',
        format: 'image/jpeg',
        zoom: { min: 0, max: 18 },
    });

    const elevationSource = new itowns.WMTSSource({
        url: 'https://data.geopf.fr/wmts?',
        crs: 'EPSG:4326',
        name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
        tileMatrixSet: 'WGS84G',
        format: 'image/x-bil;bits=32',
        zoom: { min: 0, max: 18 },
    });

    return { orthoSource, elevationSource };
}
