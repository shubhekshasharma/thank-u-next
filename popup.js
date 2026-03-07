const audioToggle = document.getElementById('audioToggle');
const volumeSlider = document.getElementById('volumeSlider');
const volumeLabel = document.getElementById('volumeLabel');

// Load saved settings and reflect them in the UI
chrome.storage.local.get(['audioEnabled', 'volume'], (stored) => {
    audioToggle.checked = stored.audioEnabled !== false; // default true

    const vol = stored.volume !== undefined ? stored.volume : 1;
    volumeSlider.value = vol;
    volumeLabel.textContent = Math.round(vol * 100) + '%';
});

audioToggle.addEventListener('change', () => {
    chrome.storage.local.set({ audioEnabled: audioToggle.checked });
});

volumeSlider.addEventListener('input', () => {
    const vol = parseFloat(volumeSlider.value);
    volumeLabel.textContent = Math.round(vol * 100) + '%';
    chrome.storage.local.set({ volume: vol });
});
