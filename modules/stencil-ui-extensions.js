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

    const anchor = panel.querySelector(anchorSelector)?.parentElement;
    if (anchor) {
        panel.insertBefore(contextBtn, anchor);
        panel.insertBefore(resetBtn, anchor);
    } else {
        panel.appendChild(contextBtn);
        panel.appendChild(resetBtn);
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
