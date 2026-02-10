export function resolveConfigUrl({
    defaultUrl,
    queryParam = 'config',
} = {}) {
    const baseUrl = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
        ? import.meta.env.BASE_URL
        : '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const fallbackUrl = defaultUrl || `${normalizedBase}configs/default.json`;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(queryParam);
    if (fromQuery) {
        if (fromQuery.startsWith('/')) return `${normalizedBase}${fromQuery.slice(1)}`;
        return fromQuery;
    }
    if (window.ITOWNS_CONFIG_URL) return window.ITOWNS_CONFIG_URL;
    return fallbackUrl;
}

export async function loadAppConfig({
    url = resolveConfigUrl(),
    silent = true,
} = {}) {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (!silent) console.warn('[itowns-xr] config not found', url, res.status);
            return null;
        }
        const json = await res.json();
        if (!silent) console.log('[itowns-xr] loaded config', url, json);
        return json;
    } catch (err) {
        if (!silent) console.warn('[itowns-xr] failed to load config', url, err);
        return null;
    }
}
