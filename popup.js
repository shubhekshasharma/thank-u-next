const enableToggle = document.getElementById('enableToggle'); // checked = extension enabled
const audioToggle = document.getElementById('audioToggle');
const volumeSlider = document.getElementById('volumeSlider');
const volumeLabel = document.getElementById('volumeLabel');
const audioRow = audioToggle.closest('.row');
const volumeRow = volumeSlider.closest('.row');

function updateSliderFill(slider) {
    const pct = (parseFloat(slider.value) - parseFloat(slider.min)) /
                (parseFloat(slider.max) - parseFloat(slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, #FF9DE2 0%, #FF9DE2 ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`;
}

function setSliderEnabled(enabled) {
    volumeSlider.disabled = !enabled;
    volumeSlider.style.opacity = enabled ? '1' : '0.35';
    volumeSlider.style.cursor = enabled ? 'pointer' : 'not-allowed';
    volumeLabel.style.opacity = enabled ? '1' : '0.35';
}

function setAllControlsEnabled(enabled) {
    audioRow.style.opacity = enabled ? '1' : '0.35';
    audioRow.style.pointerEvents = enabled ? '' : 'none';
    audioToggle.disabled = !enabled;
    setSliderEnabled(enabled && audioToggle.checked);
    volumeRow.style.opacity = (enabled && audioToggle.checked) ? '1' : '0.35';
}

// Load saved settings and reflect them in the UI
chrome.storage.local.get(['extensionEnabled', 'audioEnabled', 'volume'], (stored) => {
    const extEnabled = stored.extensionEnabled !== false; // default true
    enableToggle.checked = extEnabled; // checked = enabled
    audioToggle.checked = stored.audioEnabled !== false; // default true
    setAllControlsEnabled(extEnabled);

    const vol = stored.volume !== undefined ? stored.volume : 1;
    volumeSlider.value = vol;
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    updateSliderFill(volumeSlider);
});

enableToggle.addEventListener('change', () => {
    const extEnabled = enableToggle.checked;
    chrome.storage.local.set({ extensionEnabled: extEnabled });
    setAllControlsEnabled(extEnabled);
});

audioToggle.addEventListener('change', () => {
    chrome.storage.local.set({ audioEnabled: audioToggle.checked });
    setSliderEnabled(audioToggle.checked);
});

volumeSlider.addEventListener('input', () => {
    const vol = parseFloat(volumeSlider.value);
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    updateSliderFill(volumeSlider);
    chrome.storage.local.set({ volume: vol });
});
