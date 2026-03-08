console.log("content script loaded on Gmail!");

const emailSet = new Set();

// TODO: move these to environment variables
const OPEN_AI_LLM_URL = "";
const OPEN_AI_LLM_TOKEN = "";
const OPEN_AI_LLM_MODEL = "GPT 4.1 Mini"; 

// We maintain rejection keywords here to optimize for quick lookups and avoid unnecessary LLM calls.
// This list is not meant to be exhaustive, just good enough to catch most rejections without false positives.
const rejectionKeywords = [
    "other candidate",
    "to not move forward",
    "not to move forward",
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
let isMuted = false;
let savedWidgetPosition = null; // persists across rejection emails until page refresh
let widgetRefs = null; // live refs to the active widget's controls for real-time updates

const ACCENT = '#FF9DE2';
// Icon HTML — computed once at load time while extension context is valid
const PAUSE_ICON_HTML       = `<img src="${chrome.runtime.getURL('icons/pause.svg')}"       width="28" height="28" style="display:block;pointer-events:none">`;
const PLAY_ICON_HTML        = `<img src="${chrome.runtime.getURL('icons/play.svg')}"        width="28" height="28" style="display:block;pointer-events:none">`;
const SPEAKER_ICON_HTML     = `<img src="${chrome.runtime.getURL('icons/speaker.svg')}"     width="24" height="24" style="display:block;pointer-events:none">`;
const SPEAKER_OFF_ICON_HTML = `<img src="${chrome.runtime.getURL('icons/speaker-off.svg')}" width="24" height="24" style="display:block;pointer-events:none">`;

// Split roast text into alternating base (DM Sans) and accent (Ogg italic) words
function applyMixedTypography(text, keywords) {
    const t = text.charAt(0).toUpperCase() + text.slice(1);
    const OPEN  = `<span style="font-family:'Ogg',Georgia,serif!important;font-style:italic!important;font-weight:700!important;color:${ACCENT}!important">`;
    const CLOSE = `</span>`;

    if (!keywords || !keywords.length) {
        // Fallback: highlight every 3rd word by index
        return t.split(' ').map((word, i) =>
            i % 3 === 1 ? `${OPEN}${word}${CLOSE}` : word
        ).join(' ');
    }

    // Find all [start, end] ranges for each keyword phrase (case-insensitive)
    const ranges = [];
    for (const kw of keywords) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'gi');
        let m;
        while ((m = re.exec(t)) !== null) {
            ranges.push([m.index, m.index + m[0].length]);
        }
    }

    if (!ranges.length) return t;

    // Sort and merge overlapping ranges
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
        else merged.push(ranges[i]);
    }

    // Build output by wrapping matched ranges
    let out = '', pos = 0;
    for (const [start, end] of merged) {
        out += t.slice(pos, start) + OPEN + t.slice(start, end) + CLOSE;
        pos = end;
    }
    return out + t.slice(pos);
}

// Cached settings — kept in sync with chrome.storage.local via onChanged
let settings = { extensionEnabled: true, audioEnabled: true, volume: 1 };
chrome.storage.local.get(['extensionEnabled', 'audioEnabled', 'volume'], (stored) => {
    if (stored.extensionEnabled !== undefined) settings.extensionEnabled = stored.extensionEnabled;
    if (stored.audioEnabled     !== undefined) settings.audioEnabled     = stored.audioEnabled;
    if (stored.volume           !== undefined) settings.volume           = stored.volume;
});
chrome.storage.onChanged.addListener((changes) => {
    if (changes.extensionEnabled !== undefined) {
        settings.extensionEnabled = changes.extensionEnabled.newValue;
        if (!settings.extensionEnabled) hideWidget();
    }
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
        if (currentAudio && !isMuted) currentAudio.volume = settings.volume;
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
        currentAudio.volume = isMuted ? 0 : settings.volume;
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

const fallbackRoasts = [
    { 
        roast: "Their loss, and they'll figure that out eventually.",    
        highlight_keywords: ["their loss"] 
    },
    { 
        roast: "Not ready for you yet. That's on them.",                 
        highlight_keywords: ["on them"] },
    { 
        roast: "They picked average over exceptional. Classic.",         
        highlight_keywords: ["average", "exceptional"] },
    { 
        roast: "Onto someone who actually has taste.",                   
        highlight_keywords: ["has taste"] },
    { 
        roast: "Their hiring process clearly needs work.",               
        highlight_keywords: ["needs work"] },
    { 
        roast: "They couldn't handle the main character. Understandable.", 
        highlight_keywords: ["main character"] },
    { 
        roast: "Wrong stage. Yours is bigger anyway.",                   
        highlight_keywords: ["bigger"] },
    { 
        roast: "They had one shot and missed.",                          
        highlight_keywords: ["one shot"] },
    { 
        roast: "Not your vibe. Next.",                                   
        highlight_keywords: ["your vibe"] },
    { 
        roast: "Some doors are just not meant for you — and that's a good thing.", 
        highlight_keywords: ["good thing"] 
    },
];

const fallbackAffirmations = [
    "Your moment is just loading.",
    "The right one is still coming.",
    "On to bigger, better things.",
    "This was just not your stage.",
    "Something better is already in motion.",
    "You showed up and that's what matters.",
    "The best opportunities find you when you're ready.",
    "One step closer to the YES that counts.",
    "You're still that girl, go get it!",
    "Rest, reset, go again.",
];

// const DISMISS_TEXTS = ['Their loss.', 'Onto the next one.', 'Next.', 'Thank u, next.', 'Moving on up.'];

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
    isMuted = false;

    if (settings.audioEnabled) {
        startAudio(null, null); // refs not set yet — will be updated below after widget is built
    } else if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }

    const existing = document.getElementById('tun-controls');
    if (existing) existing.remove();


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

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = [
        'position: absolute !important',
        'top: 10px !important',
        'right: 10px !important',
        'background: none !important',
        'border: none !important',
        'color: rgba(255,255,255,0.6) !important',
        'font-size: 22px !important',
        'line-height: 1 !important',
        'padding: 0 !important',
        'border-radius: 50% !important',
        'width: 28px !important',
        'height: 28px !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important',
        'cursor: pointer !important',
        'transition: color 0.15s, background 0.15s !important',
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.setProperty('color', '#fff', 'important');
        closeBtn.style.setProperty('background', 'rgba(255,255,255,0.1)', 'important');
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.setProperty('color', 'rgba(255,255,255,0.6)', 'important');
        closeBtn.style.setProperty('background', 'none', 'important');
    });
    closeBtn.onclick = () => hideWidget();
    widget.appendChild(closeBtn);

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
        'padding-right: 24px !important',
    ].join(';');
    roastEl.innerHTML = applyMixedTypography('Calculating their loss...');
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
    affirmEl.textContent = '';
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
        `background: ${ACCENT} !important`,
        'border: none !important',
        'border-radius: 50% !important',
        'padding: 0 !important',
        'cursor: pointer !important',
        'flex-shrink: 0 !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important',
        'width: 44px !important',
        'height: 44px !important',
        'transition: background 0.15s !important',
    ].join(';');
    playPauseBtn.addEventListener('mouseenter', () => playPauseBtn.style.setProperty('background', 'rgba(255,157,226,0.75)', 'important'));
    playPauseBtn.addEventListener('mouseleave', () => playPauseBtn.style.setProperty('background', ACCENT, 'important'));
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

    const volIcon = document.createElement('button');
    volIcon.innerHTML = SPEAKER_ICON_HTML;
    volIcon.style.cssText = [
        'background: none !important',
        'border: none !important',
        'border-radius: 50% !important',
        'padding: 4px !important',
        'cursor: pointer !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important',
        'flex-shrink: 0 !important',
        'width: 36px !important',
        'height: 36px !important',
        'transition: background 0.15s !important',
    ].join(';');
    volIcon.addEventListener('mouseenter', () => volIcon.style.setProperty('background', 'rgba(255,157,226,0.12)', 'important'));
    volIcon.addEventListener('mouseleave', () => volIcon.style.setProperty('background', 'none', 'important'));
    let preMuteVolume = settings.volume;
    volIcon.onclick = () => {
        isMuted = !isMuted;
        if (isMuted) {
            preMuteVolume = parseFloat(volSlider.value);
            if (currentAudio) currentAudio.volume = 0;
            volSlider.value = '0';
            volIcon.innerHTML = SPEAKER_OFF_ICON_HTML;
        } else {
            volSlider.value = String(preMuteVolume);
            if (currentAudio) currentAudio.volume = preMuteVolume;
            volIcon.innerHTML = SPEAKER_ICON_HTML;
        }
    };

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.05';
    volSlider.value = String(settings.volume);
    volSlider.style.cssText = `flex:1 !important; accent-color:${ACCENT} !important; cursor:pointer !important;`;
    volSlider.oninput = () => {
        const vol = parseFloat(volSlider.value);
        if (isMuted) {
            isMuted = false;
            volIcon.innerHTML = SPEAKER_ICON_HTML;
        }
        if (currentAudio) currentAudio.volume = vol;
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

    return {
        setRoast: (roast, keywords) => { roastEl.innerHTML = applyMixedTypography(roast, keywords); },
        setAffirmation: (text) => { affirmEl.textContent = text; },
    };
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
      hideWidget();
      return;
    }

    if (!settings.extensionEnabled) {
      return;
    }

    const lowerBodyText = bodyText.toLowerCase();
    const containsAny = rejectionKeywords.some(element => lowerBodyText.includes(element));

    if (!containsAny) {
        console.log('Not a rejection email');
        hideWidget();
        return;
    }

    if (emailKey && emailSet.has(emailKey)) {
      return;
    }

    emailSet.add(emailKey);

    console.log('Rejection detected')

    const { setRoast, setAffirmation } = playRejectionAudio();

    if (!OPEN_AI_LLM_URL) {
        console.warn('LLM URL not configured, using fallback.');
        const fb = fallbackRoasts[Math.floor(Math.random() * fallbackRoasts.length)];
        setRoast(fb.roast, fb.highlight_keywords);
        setAffirmation(fallbackAffirmations[Math.floor(Math.random() * fallbackAffirmations.length)]);
        return;
    }

    const prompt = `You are a witty, supportive best friend. A company just rejected me and I need a roast.

Generate a roast AND an affirmation as a pair that work together tonally.

Rules for the roast:
- Short, punchy, confident — not mean or personal
- "their loss" energy, never bitter or attacking individuals
- Wordplay or puns on the company name only if it fits naturally, never forced
- Conversational, like a best friend said it, not a comedian trying too hard
- No asterisks, no first person, no special formatting


Rules for the affirmation:
- Should feel like a natural follow-up to the roast
- Warm, about the user, short
- Should land the emotional arc the roast set up
- IMPORTANT: Do not assume company name, do not hallucinate. If you cannot extract name, you can use "They". 

Rules for the highlight keywords:
- NEVER NEVER include the company name as highlight word even if it appears in a combination, NEVER include stop words like "the", "and", "with", "their", "they"
- Return exactly ONE string — a single word or two-word phrase
- It must be the single most impactful moment in the roast — the punchline, the twist, the sting, the part that makes it land
- Think about which words you'd say louder or slower if speaking the roast out loud
- Prioritize words that carry the wit, the sting, or the punchline — the words that make it land
- Good candidates: unexpected word choices, ironic words, the twist in the joke
- Bad candidates: the company name itself, stop words, verbs like "missed" or "passed", filler words, the setup of the joke
- Each item is either a single word or a short contiguous phrase (max 2 words) from the roast
- Must be exact substrings of the roast for styling purposes

Some roast examples (the company names below are just examples but notice how the pun works because the company name already implies something and the roast just flips it):
- "ClaritieA couldn't see what was right in front of them."
- "ApeeeX passed on the peak — their loss."
- "HorrrizonnNN missed the view entirely."

Return ONLY a JSON object like this, nothing else:
{"roast": "...", "affirmation": "...", "highlight_keywords": ["..."]}

Company and email context: ${bodyText.slice(0, 300)}`

    makeLLMRequest(prompt)
        .then(res => {
            if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
            return res.json();
        })
        .then(data => {
            console.log('LLM response:', data);
            const raw = data.choices[0].message.content || '';
            try {
                const parsed = JSON.parse(raw);
                if (parsed.roast) setRoast(parsed.roast, parsed.highlight_keywords);
                if (parsed.affirmation) setAffirmation(parsed.affirmation);
            } catch {
                // JSON parse failed — show fallbacks
                const fb = fallbackRoasts[Math.floor(Math.random() * fallbackRoasts.length)];
                setRoast(fb.roast, fb.highlight_keywords);
                setAffirmation(fallbackAffirmations[Math.floor(Math.random() * fallbackAffirmations.length)]);
            }
        })
        .catch(err => {
            console.error('Error fetching roast:', err);
            const fb = fallbackRoasts[Math.floor(Math.random() * fallbackRoasts.length)];
            setRoast(fb.roast, fb.highlight_keywords);
            setAffirmation(fallbackAffirmations[Math.floor(Math.random() * fallbackAffirmations.length)]);
        });

  }, 500);
});


observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});