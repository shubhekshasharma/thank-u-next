console.log("content script loaded on Gmail!");

const emailSet = new Set();

// TODO: move these to environment variables
const OPEN_AI_LLM_URL = "";
const OPEN_AI_LLM_TOKEN = "";
const OPEN_AI_LLM_MODEL = "GPT 4.1 Mini"; 

const rejectionKeywords = [
    "other candidate",
    "we've decided to move forward with other candidates",
    "decided to move forward with other candidates",
    "move forward with another candidate",
    "moving forward with other candidates",
    "have not been selected",
    "will not be able to move forward",
    "will not be moving forward",
    "won't be moving forward",
    "won’t be moving forward",
    "not been selected to move forward",
    "chosen to move forward with another candidate",
    "we have selected another candidate",
    "regret to inform you",
    "did not work out",
    "won't be proceeding to the interview stage",
    "pursue other candidates",
    "we are moving forward with other candidates",
    "not selected for further consideration", 
    "decided to pursue other candidates"
];

function makeLLMRequest(prompt) {
    return fetch(OPEN_AI_LLM_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPEN_AI_LLM_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: OPEN_AI_LLM_MODEL,
            messages: [
                { role: "user", content: prompt }
            ]
        })
    });
}


let currentAudio = null;
let savedWidgetPosition = null; // persists across rejection emails until page refresh
let widgetRefs = null; // live refs to the active widget's controls for real-time updates

const ACCENT = '#FF9DE2';
// Icon HTML — computed once at load time while extension context is valid
const PAUSE_ICON_HTML   = `<img src="${chrome.runtime.getURL('icons/pause.svg')}"   width="40" height="40" style="display:block;pointer-events:none">`;
const PLAY_ICON_HTML    = `<img src="${chrome.runtime.getURL('icons/play.svg')}"    width="40" height="40" style="display:block;pointer-events:none">`;
const SPEAKER_ICON_HTML = `<img src="${chrome.runtime.getURL('icons/speaker.svg')}" width="28" height="28" style="display:block;pointer-events:none">`;

// Split roast text into alternating base (DM Sans) and accent (Ogg italic) words
function applyMixedTypography(text) {
    const t = text.charAt(0).toUpperCase() + text.slice(1);
    return t.split(' ').map((word, i) =>
        i % 3 === 1
            ? `<span style="font-family:'Ogg',Georgia,serif!important;font-style:italic!important;font-weight:700!important;color:${ACCENT}!important">${word}</span>`
            : word
    ).join(' ');
}

// Cached settings — kept in sync with chrome.storage.local via onChanged
let settings = { audioEnabled: true, volume: 1 };
chrome.storage.local.get(['audioEnabled', 'volume'], (stored) => {
    if (stored.audioEnabled !== undefined) settings.audioEnabled = stored.audioEnabled;
    if (stored.volume       !== undefined) settings.volume       = stored.volume;
});
chrome.storage.onChanged.addListener((changes) => {
    if (changes.audioEnabled !== undefined) {
        settings.audioEnabled = changes.audioEnabled.newValue;
        if (widgetRefs) {
            // Show/hide audio controls on the live widget
            widgetRefs.controlsRow.style.setProperty(
                'display', settings.audioEnabled ? 'flex' : 'none', 'important'
            );
            if (settings.audioEnabled) {
                startAudio(widgetRefs.playPauseBtn, widgetRefs.widget);
                widgetRefs.playPauseBtn.innerHTML = PAUSE_ICON_HTML;
            } else if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio = null;
                widgetRefs.playPauseBtn.innerHTML = PLAY_ICON_HTML;
            }
        }
    }
    if (changes.volume !== undefined) {
        settings.volume = changes.volume.newValue;
        if (currentAudio) currentAudio.volume = settings.volume;
        if (widgetRefs) widgetRefs.volSlider.value = String(settings.volume);
    }
});

function startAudio(playPauseBtn, widget) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    try {
        currentAudio = new Audio(chrome.runtime.getURL('thank-u-next.m4a'));
        currentAudio.volume = settings.volume;
        currentAudio.play().catch(err => console.error('Audio failed to play:', err));
        currentAudio.addEventListener('ended', () => {
            if (playPauseBtn) playPauseBtn.innerHTML = PLAY_ICON_HTML;
            widget.remove();
            widgetRefs = null;
        });
    } catch (e) {
        console.warn('thank-u-next: extension context invalidated, please reload the page.', e);
    }
}

const AFFIRMATIONS = [
    "you're that girl. full stop.",
    "your moment is just loading.",
    "the right one is still coming.",
    "on to bigger, better things.",
    "this was just not your stage.",
    "something better is already in motion.",
    "you showed up. that matters.",
    "the best opportunities find you when you're ready.",
    "one no closer to the yes that counts.",
    "you're still that girl. nothing changed.",
    "rest, reset, go again.",
];

const DISMISS_TEXTS = ['their loss.', 'onto the next one.', 'next.', 'thank u, next.', 'moving on up.'];

function hideWidget() {
    const existing = document.getElementById('tun-controls');
    if (existing) {
        existing.remove();
        widgetRefs = null;
        if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
    }
}

// Returns a setRoast(text) function to update the roast once the LLM responds
function playRejectionAudio() {
    widgetRefs = null;

    if (settings.audioEnabled) {
        startAudio(null, null); // refs not set yet — will be updated below after widget is built
    } else if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }

    const existing = document.getElementById('tun-controls');
    if (existing) existing.remove();

    const affirmation = AFFIRMATIONS[Math.floor(Math.random() * AFFIRMATIONS.length)];

    // Inject DM Sans (Google Fonts) + Ogg (local Adobe Fonts) once
    if (!document.getElementById('tun-fonts')) {
        const fontLink = document.createElement('link');
        fontLink.id = 'tun-fonts';
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;1,300&display=swap';
        document.head.appendChild(fontLink);

        const fontStyle = document.createElement('style');
        fontStyle.id = 'tun-ogg';
        fontStyle.textContent = `
            @font-face{font-family:'Ogg';src:local('Ogg Bold Italic'),local('Ogg-BoldItalic'),local('Ogg');font-weight:700;font-style:italic;}
            #tun-controls input[type=range]{height:5px}
            #tun-controls input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:${ACCENT};cursor:pointer;margin-top:-6.5px}
            #tun-controls input[type=range]::-webkit-slider-runnable-track{height:5px;border-radius:3px}
            #tun-controls input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:${ACCENT};border:none;cursor:pointer}
        `;
        document.head.appendChild(fontStyle);
    }

    // Widget
    const widget = document.createElement('div');
    widget.id = 'tun-controls';
    widget.style.cssText = [
        'position: fixed !important',
        'z-index: 2147483647 !important',
        'background: #21161C !important',
        'border-radius: 20px !important',
        'padding: 16px !important',
        'width: 340px !important',
        'box-shadow: 0 20px 60px rgba(0,0,0,0.7) !important',
        'border: 1px solid rgba(255,255,255,0.06) !important',
        'color: #fff !important',
        'display: flex !important',
        'flex-direction: column !important',
        'gap: 0 !important',
        'visibility: visible !important',
        'opacity: 1 !important',
        'cursor: grab !important',
        'user-select: none !important',
    ].join(';');

    // Apply saved position or default to bottom-right
    if (savedWidgetPosition) {
        widget.style.setProperty('top', savedWidgetPosition.top, 'important');
        widget.style.setProperty('left', savedWidgetPosition.left, 'important');
    } else {
        widget.style.setProperty('bottom', '28px', 'important');
        widget.style.setProperty('right', '28px', 'important');
    }

    // Roast — DM Sans base, Ogg italic accent words via mixed typography
    const roastEl = document.createElement('div');
    roastEl.style.cssText = [
        `font-family: 'DM Sans', system-ui, sans-serif !important`,
        'font-size: 24px !important',
        'font-weight: 300 !important',
        'color: #ffffff !important',
        'line-height: 1.4 !important',
        'min-height: 0 !important',
        'margin-bottom: 8px !important',
    ].join(';');
    roastEl.innerHTML = applyMixedTypography('generating your roast...');
    widget.appendChild(roastEl);

    // Affirmation — lighter font, no divider
    const affirmEl = document.createElement('div');
    affirmEl.style.cssText = [
        `font-family: 'DM Sans', system-ui, sans-serif !important`,
        'font-size: 16px !important',
        'font-weight: 300 !important',
        'color: #D3D0D2 !important',
        'line-height: 1.5 !important',
        'margin-bottom: 18px !important',
    ].join(';');
    affirmEl.textContent = affirmation;
    widget.appendChild(affirmEl);

    // Audio controls — always rendered, hidden when audio is disabled
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = [
        'align-items: center !important',
        'gap: 10px !important',
        settings.audioEnabled ? 'display:flex !important' : 'display:none !important',
    ].join(';');

    const playPauseBtn = document.createElement('button');
    playPauseBtn.innerHTML = PAUSE_ICON_HTML;
    playPauseBtn.style.cssText = [
        'background: none !important',
        'border: none !important',
        'padding: 0 !important',
        'cursor: pointer !important',
        'flex-shrink: 0 !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important',
        'width: 40px !important',
        'height: 40px !important',
    ].join(';');
    playPauseBtn.onclick = () => {
        if (!currentAudio) return;
        if (currentAudio.paused) {
            currentAudio.play();
            playPauseBtn.innerHTML = PAUSE_ICON_HTML;
        } else {
            currentAudio.pause();
            playPauseBtn.innerHTML = PLAY_ICON_HTML;
        }
    };

    const volIcon = document.createElement('span');
    volIcon.innerHTML = SPEAKER_ICON_HTML;
    volIcon.style.cssText = 'display:flex !important; align-items:center !important; flex-shrink:0 !important;';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.05';
    volSlider.value = String(settings.volume);
    volSlider.style.cssText = `flex:1 !important; accent-color:${ACCENT} !important; cursor:pointer !important;`;
    volSlider.oninput = () => {
        if (currentAudio) currentAudio.volume = parseFloat(volSlider.value);
    };

    controlsRow.appendChild(playPauseBtn);
    controlsRow.appendChild(volIcon);
    controlsRow.appendChild(volSlider);
    widget.appendChild(controlsRow);

    document.documentElement.appendChild(widget);

    // Store refs so onChanged can live-update this widget
    widgetRefs = { controlsRow, playPauseBtn, volSlider, widget };
    // Re-run startAudio now that refs exist, so the ended listener can reference them
    if (settings.audioEnabled) startAudio(playPauseBtn, widget);

    // Drag logic — saves position so next rejection email opens in the same spot
    let isDragging = false, dragStartX, dragStartY, widgetStartLeft, widgetStartTop;
    widget.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        isDragging = true;
        const rect = widget.getBoundingClientRect();
        widget.style.setProperty('bottom', 'auto', 'important');
        widget.style.setProperty('right', 'auto', 'important');
        widget.style.setProperty('top', rect.top + 'px', 'important');
        widget.style.setProperty('left', rect.left + 'px', 'important');
        widget.style.setProperty('cursor', 'grabbing', 'important');
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        widgetStartLeft = rect.left;
        widgetStartTop = rect.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        widget.style.setProperty('left', (widgetStartLeft + e.clientX - dragStartX) + 'px', 'important');
        widget.style.setProperty('top', (widgetStartTop + e.clientY - dragStartY) + 'px', 'important');
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        widget.style.setProperty('cursor', 'grab', 'important');
        const rect = widget.getBoundingClientRect();
        savedWidgetPosition = { top: rect.top + 'px', left: rect.left + 'px' };
    });

    return (roast) => { roastEl.innerHTML = applyMixedTypography(roast); };
}

let timeout;
const observer = new MutationObserver(() => {
  clearTimeout(timeout);

  timeout = setTimeout(() => {

    const emailTitle = document.querySelector('.hP')?.innerText;
    const bodyText = document.querySelector('.a3s.aiL')?.innerText;

    const email =  document.querySelector('.gD')?.getAttribute('email')

    const emailKey = `${emailTitle}-${email}`;

    if (!bodyText) {
      return;
    }

    const lowerBodyText = bodyText.toLowerCase();
    const containsAny = rejectionKeywords.some(element => lowerBodyText.includes(element));

    if (!containsAny) {
        console.log(`Not a rejection email from ${email}`);
        hideWidget();
        return;
    }

    if (emailKey && emailSet.has(emailKey)) {
      return;
    }

    emailSet.add(emailKey);

    console.log(`Rejection detected from ${email}`)

    const setRoast = playRejectionAudio();

    if (!OPEN_AI_LLM_URL) {
        console.warn('LLM URL not configured, skipping roast generation.');
        return;
    }

    const company = email.split('@')[1].split('.')[0]
    const companyName = company.charAt(0).toUpperCase() + company.slice(1)

    const prompt = `
    You are a witty, supportive best friend roasting a company that just sent a rejection email.
    Given the company name and email excerpt, write ONE short, funny, lighthearted roast (max 15 words).
    Be savage but not mean. Think Ariana Grande "thank u, next" energy.
    No quotes, no emojis, just the roast.
    Company: ${companyName}
    Email excerpt: ${emailTitle} - ${bodyText}
    `

    const response = makeLLMRequest(prompt)
        .then(res => {
            if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
            return res.json();
        })
        .then(data => {
            console.log('LLM response:', data);
            const roast = data.choices[0].message.content || "Sorry, couldn't come up with a roast this time!";
            console.log(`Roast for ${companyName}: ${roast}`);
            setRoast(roast);
        })
        .catch(err => {
            console.error('Error fetching roast:', err);
        })
    ;

  }, 500);
});


observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});