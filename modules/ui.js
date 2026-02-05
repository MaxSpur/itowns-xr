import * as THREE from 'three';

const VIEW_RADIUS_MIN = 1;
const VIEW_RADIUS_MAX = 20000;

export function radiusFromSlider01(u) {
    const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return VIEW_RADIUS_MIN * Math.pow(k, clamped);
}

function slider01FromRadius(rMeters) {
    const clamped = THREE.MathUtils.clamp(+rMeters || VIEW_RADIUS_MIN, VIEW_RADIUS_MIN, VIEW_RADIUS_MAX);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return Math.log(clamped / VIEW_RADIUS_MIN) / Math.log(k);
}

const PANEL_BASE_STYLE = {
    position: 'absolute',
    zIndex: 100,
    background: '#171b2833',
    border: '1px solid #2e344a',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    minWidth: '260px',
    maxWidth: '290px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
};

export const UI_BUTTON_STYLE =
    'padding:7px 12px;border-radius:6px;background:transparent;color:inherit;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;cursor:pointer;';

const UI_STYLE_TAG_ID = 'itowns-stencil-ui-styles';

function applyPanelStyle(element, overrides = {}) {
    Object.assign(element.style, PANEL_BASE_STYLE, overrides);
}

function ensureUIPanelStyles() {
    if (document.getElementById(UI_STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = UI_STYLE_TAG_ID;
    style.textContent = `
    .itowns-ui-panel button {
      border: 1px solid #2e344a;
      background: rgba(58,61,79,0.45);
      color: #f4f7ff;
      transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .itowns-ui-panel button:hover { background: rgba(85, 101, 138, 0.7); border-color: #55618c; }
    .itowns-ui-panel button:active { background: #6573b5; border-color: #8797d5; }
    .itowns-ui-panel button.is-active {
      background: #5e6dd0;
      border-color: #8ea0ff;
      box-shadow: 0 0 12px rgba(102, 141, 255, 0.4);
      color: #fff;
    }
    .itowns-ui-panel input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.22);
      outline: none;
      cursor: pointer;
    }
    .itowns-ui-panel input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #8fb4ff;
      background: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      transition: transform 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-webkit-slider-thumb {
      transform: scale(1.08);
      border-color: #a7c6ff;
    }
    .itowns-ui-panel .itowns-ui-header {
      font-weight: bold;
      font-size: 14px;
      border-bottom: 1px solid #555;
      padding-bottom: 5px;
      cursor: pointer;
      user-select: none;
    }
    .itowns-ui-panel.is-collapsed .itowns-ui-body {
      display: none;
    }
    .itowns-ui-panel.is-collapsed {
      padding-bottom: 10px;
    }
  `;
    document.head.appendChild(style);
}

export function createStencilWidget({
    idPrefix, title, panelPos,
    onTogglePick, onRadius01, onOpacity,
    onReset, onToggleCylinder,
    onToggleStencil,
    onToggleRotate,
    onResetGlobe,
    onLog,
    panelStyle = {},
    rotateButtonLabel,
    pickButtonLabel = 'Reposition (click map)',
    controls = {},
}) {
    ensureUIPanelStyles();

    const panel = document.createElement('div');
    applyPanelStyle(panel, { ...panelPos, ...panelStyle });
    panel.classList.add('itowns-ui-panel');

    const state = { radius: 1500, picking: false, opacity: 0.35 };

    const activeControls = {
        pick: true,
        center: true,
        log: true,
        stencil: true,
        rotate: true,
        resetGlobe: true,
        status: true,
        ...controls,
    };

    const pickId = `${idPrefix}-pick`;
    const rId = `${idPrefix}-r`;
    const rvId = `${idPrefix}-rv`;
    const rvRawId = `${idPrefix}-rv-raw`;
    const oId = `${idPrefix}-o`;
    const ovId = `${idPrefix}-ov`;
    const statusId = `${idPrefix}-status`;

    const pickHtml = activeControls.pick
        ? `<button id="${pickId}" style="${UI_BUTTON_STYLE}">${pickButtonLabel}</button>`
        : '';
    const centerHtml = activeControls.center
        ? `<button id="${idPrefix}-reset" style="${UI_BUTTON_STYLE}">Center</button>`
        : '';
    const logHtml = activeControls.log
        ? `<button id="${idPrefix}-log" style="${UI_BUTTON_STYLE}">Log</button>`
        : '';
    const actionButtons = [centerHtml, `<button id="${idPrefix}-vis" style="${UI_BUTTON_STYLE}">Hide cyl</button>`, logHtml]
        .filter(Boolean)
        .join('\n');
    const actionRowHtml = `<div style="display:flex; gap:8px; flex-wrap:wrap;">${actionButtons}</div>`;
    const stencilHtml = activeControls.stencil
        ? `<button id="${idPrefix}-stencil" style="${UI_BUTTON_STYLE}; align-self:flex-start;">Disable stencil</button>`
        : '';
    const rotateRowHtml = rotateButtonLabel && (activeControls.rotate || activeControls.resetGlobe)
        ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">
      ${activeControls.rotate ? `<button id="${idPrefix}-rotate" style="${UI_BUTTON_STYLE};">${rotateButtonLabel}</button>` : ''}
      ${activeControls.resetGlobe ? `<button id="${idPrefix}-reset-globe" style="${UI_BUTTON_STYLE};">Reset globe</button>` : ''}
    </div>` : '';
    const statusHtml = activeControls.status
        ? `<div id="${statusId}" style="opacity:0.85;">Patched tile materials: 0</div>`
        : '';

    panel.innerHTML = `
    <div class="itowns-ui-header">${title}</div>
    <div class="itowns-ui-body">
      ${pickHtml}

      ${actionRowHtml}

      ${stencilHtml}
      ${rotateRowHtml}

      <div style="display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between;">
          <span>Radius</span>
          <span id="${rvId}">${state.radius.toFixed(0)} m</span>
        </div>
        <div style="display:flex; justify-content:space-between; opacity:0.7; font-size:11px;">
          <span>View radius</span>
          <span id="${rvRawId}">${state.radius.toFixed(0)} m</span>
        </div>
        <input id="${rId}" type="range" min="0" max="1" step="0.001" value="${slider01FromRadius(state.radius)}">
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between;">
          <span>Cylinder opacity</span>
          <span id="${ovId}">${state.opacity.toFixed(2)}</span>
        </div>
        <input id="${oId}" type="range" min="0" max="1" step="0.01" value="${state.opacity}">
      </div>

      ${statusHtml}
    </div>
  `;

    document.body.appendChild(panel);

    const header = panel.querySelector('.itowns-ui-header');
    const body = panel.querySelector('.itowns-ui-body');

    const btnPick = panel.querySelector(`#${pickId}`);

    const btnReset = panel.querySelector(`#${idPrefix}-reset`);
    const btnVis = panel.querySelector(`#${idPrefix}-vis`);
    const btnLog = panel.querySelector(`#${idPrefix}-log`);
    const btnStencil = panel.querySelector(`#${idPrefix}-stencil`);
    const btnRotate = panel.querySelector(`#${idPrefix}-rotate`);
    const btnResetGlobe = panel.querySelector(`#${idPrefix}-reset-globe`);

    const radiusInput = panel.querySelector(`#${rId}`);
    const radiusLabel = panel.querySelector(`#${rvId}`);
    const radiusRawLabel = panel.querySelector(`#${rvRawId}`);
    const opacityInput = panel.querySelector(`#${oId}`);
    const opacityLabel = panel.querySelector(`#${ovId}`);
    const status = panel.querySelector(`#${statusId}`);

    // Hard fail early if something is wrong (prevents silent null usage)
    const rotateControlsExpected = !!rotateButtonLabel;
    const required = [
        radiusInput && radiusLabel && opacityInput && opacityLabel,
        !activeControls.pick || btnPick,
        !activeControls.stencil || btnStencil,
        !activeControls.center || btnReset,
        !activeControls.log || btnLog,
        !rotateControlsExpected || !activeControls.rotate || btnRotate,
        !rotateControlsExpected || !activeControls.resetGlobe || btnResetGlobe,
        !activeControls.status || status,
    ];
    if (required.some((ok) => !ok)) throw new Error(`[UI] Missing element(s) for widget "${idPrefix}"`);

    if (header && body) {
        header.addEventListener('click', () => {
            panel.classList.toggle('is-collapsed');
        });
    }

    const setPicking = (v) => {
        state.picking = !!v;
        if (btnPick) btnPick.classList.toggle('is-active', state.picking);
        onTogglePick?.(state.picking);
    };

    if (btnPick) btnPick.addEventListener('click', () => setPicking(!state.picking));

    radiusInput.addEventListener('input', (e) => {
        const u = parseFloat(e.target.value);
        state.radius = radiusFromSlider01(u);
        radiusLabel.textContent = `${state.radius.toFixed(0)} m`;
        if (radiusRawLabel) radiusRawLabel.textContent = `${state.radius.toFixed(0)} m`;
        onRadius01?.(u);
    });

    opacityInput.addEventListener('input', (e) => {
        state.opacity = parseFloat(e.target.value);
        opacityLabel.textContent = state.opacity.toFixed(2);
        onOpacity?.(state.opacity);
    });

    let cylVisible = true;
    let stencilEnabled = true;
    let rotateMode = false;

    if (btnReset) btnReset.addEventListener('click', () => onReset?.());
    if (btnLog) btnLog.addEventListener('click', () => onLog?.());

    if (btnVis) btnVis.addEventListener('click', () => {
        cylVisible = !cylVisible;
        btnVis.textContent = cylVisible ? 'Hide cyl' : 'Show cyl';
        onToggleCylinder?.(cylVisible);
    });

    const setStencilEnabled = (enabled) => {
        stencilEnabled = !!enabled;
        const disabled = !stencilEnabled;
        if (btnStencil) {
            btnStencil.classList.toggle('is-active', disabled);
            btnStencil.textContent = disabled ? 'Enable stencil' : 'Disable stencil';
        }
        onToggleStencil?.(stencilEnabled);
    };

    if (btnStencil) {
        btnStencil.addEventListener('click', () => {
            setStencilEnabled(!stencilEnabled);
        });
    }

    const setRotateMode = (v) => {
        rotateMode = !!v;
        if (btnRotate) btnRotate.classList.toggle('is-active', rotateMode);
        onToggleRotate?.(rotateMode);
    };
    if (btnRotate) btnRotate.addEventListener('click', () => setRotateMode(!rotateMode));
    if (btnResetGlobe) btnResetGlobe.addEventListener('click', () => onResetGlobe?.());

    const setStencilEnabledPublic = setStencilEnabled;
    const setRotateModePublic = setRotateMode;
    return { panel, status, setPicking, setStencilEnabled: setStencilEnabledPublic, setRotateMode: setRotateModePublic };
}
