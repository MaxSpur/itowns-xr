import { UI_BUTTON_STYLE } from './ui.js';

export function attachContextControls({
    panel,
    onToggle,
    onReset,
    initialEnabled = false,
    contextLabel = 'Context mode',
    contextLabelOn = 'Context mode on',
    buttonStyle = UI_BUTTON_STYLE,
    anchorSelector = 'input[type="range"]',
}) {
    if (!panel) return { setContextButtonState: () => {} };

    const contextBtn = document.createElement('button');
    contextBtn.style.cssText = buttonStyle;
    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = buttonStyle;
    resetBtn.textContent = 'Reset globes';

    const container = panel.querySelector('.itowns-ui-body') || panel;
    const anchor = container.querySelector(anchorSelector)?.parentElement;
    if (anchor) {
        container.insertBefore(contextBtn, anchor);
        container.insertBefore(resetBtn, anchor);
    } else {
        container.appendChild(contextBtn);
        container.appendChild(resetBtn);
    }

    const setContextButtonState = (enabled) => {
        contextBtn.classList.toggle('is-active', enabled);
        contextBtn.textContent = enabled ? contextLabelOn : contextLabel;
    };
    setContextButtonState(initialEnabled);

    contextBtn.addEventListener('click', () => {
        const next = !contextBtn.classList.contains('is-active');
        onToggle?.(next);
        setContextButtonState(next);
    });

    resetBtn.addEventListener('click', () => onReset?.());

    return { contextBtn, resetBtn, setContextButtonState };
}

export function attachScaleControls({
    panel,
    initialScale = 1,
    sliderFromScale,
    scaleFromSlider,
    formatScale,
    onScale,
}) {
    if (!panel) return { setScale: () => {} };

    const scaleSeparator = document.createElement('div');
    scaleSeparator.style.cssText = 'height:1px;background:rgba(255,255,255,0.12);margin:6px 0;';
    const scaleRow = document.createElement('div');
    scaleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = 'Scale';
    const scaleValue = document.createElement('span');
    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleValue);

    const scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.min = '0';
    scaleInput.max = '1';
    scaleInput.step = '0.001';
    scaleInput.style.width = '100%';

    const scaleWrap = document.createElement('div');
    scaleWrap.style.display = 'flex';
    scaleWrap.style.flexDirection = 'column';
    scaleWrap.style.gap = '6px';
    scaleWrap.appendChild(scaleRow);
    scaleWrap.appendChild(scaleInput);

    panel.appendChild(scaleSeparator);
    panel.appendChild(scaleWrap);

    const setScale = (scale) => {
        const slider = sliderFromScale?.(scale) ?? 0.5;
        scaleInput.value = `${slider}`;
        scaleValue.textContent = formatScale ? formatScale(scale) : `${scale}`;
    };

    scaleInput.addEventListener('input', (e) => {
        const u = parseFloat(e.target.value);
        const scale = scaleFromSlider?.(u) ?? initialScale;
        scaleValue.textContent = formatScale ? formatScale(scale) : `${scale}`;
        onScale?.(scale);
    });

    setScale(initialScale);

    return { scaleInput, scaleValue, setScale };
}

export function attachDumpControls({
    panel,
    onDump,
    label = 'Dump config',
    buttonStyle = UI_BUTTON_STYLE,
    anchorSelector,
}) {
    if (!panel) return { dumpBtn: null };
    const dumpBtn = document.createElement('button');
    dumpBtn.style.cssText = buttonStyle;
    dumpBtn.textContent = label;

    const container = panel.querySelector('.itowns-ui-body') || panel;
    const anchor = anchorSelector ? container.querySelector(anchorSelector) : null;
    if (anchor?.parentElement) {
        container.insertBefore(dumpBtn, anchor.parentElement);
    } else {
        container.appendChild(dumpBtn);
    }

    dumpBtn.addEventListener('click', () => onDump?.());
    return { dumpBtn };
}

export function attachSavedViewsControls({
    panel,
    initialItems = [],
    onSave,
    onApply,
    onDelete,
    buttonStyle = UI_BUTTON_STYLE,
    anchorSelector = 'input[type="range"]',
}) {
    if (!panel) return { setItems: () => {}, selectById: () => {}, getSelectedId: () => null };

    const container = panel.querySelector('.itowns-ui-body') || panel;
    const anchor = anchorSelector ? container.querySelector(anchorSelector)?.parentElement : null;

    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.12);margin:6px 0;';

    const title = document.createElement('div');
    title.textContent = 'Saved views';
    title.style.cssText = 'font-weight:600;opacity:0.95;';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Name';
    nameInput.style.cssText = 'width:100%;border:1px solid #2e344a;background:rgba(58,61,79,0.45);color:#fff;border-radius:6px;padding:6px 8px;';

    const list = document.createElement('select');
    list.size = 5;
    list.style.cssText = 'width:100%;border:1px solid #2e344a;background:rgba(58,61,79,0.45);color:#fff;border-radius:6px;padding:4px;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = buttonStyle;
    saveBtn.textContent = 'Save view';
    const applyBtn = document.createElement('button');
    applyBtn.style.cssText = buttonStyle;
    applyBtn.textContent = 'Apply';
    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = buttonStyle;
    deleteBtn.textContent = 'Delete';

    actions.appendChild(saveBtn);
    actions.appendChild(applyBtn);
    actions.appendChild(deleteBtn);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    wrap.appendChild(sep);
    wrap.appendChild(title);
    wrap.appendChild(nameInput);
    wrap.appendChild(list);
    wrap.appendChild(actions);

    if (anchor) {
        container.insertBefore(wrap, anchor);
    } else {
        container.appendChild(wrap);
    }

    const state = { items: [] };

    const getSelectedId = () => {
        const opt = list.options[list.selectedIndex];
        return opt?.value || null;
    };

    const setItems = (items = []) => {
        state.items = items.slice();
        const selected = getSelectedId();
        list.innerHTML = '';
        state.items.forEach((item, idx) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name || `View ${idx + 1}`;
            list.appendChild(option);
        });
        if (!state.items.length) return;
        const restoreIndex = selected ? state.items.findIndex((i) => i.id === selected) : -1;
        list.selectedIndex = restoreIndex >= 0 ? restoreIndex : 0;
    };

    const selectById = (id) => {
        if (!id) return;
        const idx = state.items.findIndex((i) => i.id === id);
        if (idx >= 0) list.selectedIndex = idx;
    };

    saveBtn.addEventListener('click', () => {
        onSave?.(nameInput.value?.trim() || '');
        nameInput.value = '';
    });
    applyBtn.addEventListener('click', () => {
        const id = getSelectedId();
        if (!id) return;
        onApply?.(id);
    });
    deleteBtn.addEventListener('click', () => {
        const id = getSelectedId();
        if (!id) return;
        onDelete?.(id);
    });
    list.addEventListener('dblclick', () => {
        const id = getSelectedId();
        if (!id) return;
        onApply?.(id);
    });

    setItems(initialItems);
    return { setItems, selectById, getSelectedId, list, nameInput, saveBtn, applyBtn, deleteBtn };
}
