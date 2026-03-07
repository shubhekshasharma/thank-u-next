const audioToggle = document.getElementById('audioToggle');
const volumeSlider = document.getElementById('volumeSlider');
const volumeLabel = document.getElementById('volumeLabel');

function updateSliderFill(slider) {
    const pct = (parseFloat(slider.value) - parseFloat(slider.min)) /
                (parseFloat(slider.max) - parseFloat(slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, #FF9DE2 0%, #FF9DE2 ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`;
}

// Load saved settings and reflect them in the UI
chrome.storage.local.get(['audioEnabled', 'volume'], (stored) => {
    audioToggle.checked = stored.audioEnabled !== false; // default true

    const vol = stored.volume !== undefined ? stored.volume : 1;
    volumeSlider.value = vol;
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    updateSliderFill(volumeSlider);
});

audioToggle.addEventListener('change', () => {
    chrome.storage.local.set({ audioEnabled: audioToggle.checked });
});

volumeSlider.addEventListener('input', () => {
    const vol = parseFloat(volumeSlider.value);
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    updateSliderFill(volumeSlider);
    chrome.storage.local.set({ volume: vol });
});
