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
                // Restart audio from the beginning
                startAudio(widgetRefs.playPauseBtn, widgetRefs.widget);
            } else if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio = null;
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
            if (playPauseBtn) playPauseBtn.textContent = '▶';
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
    const dismissText = DISMISS_TEXTS[Math.floor(Math.random() * DISMISS_TEXTS.length)];

    // Widget
    const widget = document.createElement('div');
    widget.id = 'tun-controls';
    widget.style.cssText = [
        'position: fixed !important',
        'z-index: 2147483647 !important',
        'background: #0d0d0d !important',
        'border-radius: 16px !important',
        'padding: 20px !important',
        'width: 300px !important',
        'box-shadow: 0 12px 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(233,30,140,0.25) !important',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important',
        'color: #fff !important',
        'display: flex !important',
        'flex-direction: column !important',
        'gap: 14px !important',
        'visibility: visible !important',
        'opacity: 1 !important',
        'cursor: grab !important',
        'user-select: none !important',
    ].join(';');

    // Apply saved position or default to top-right
    if (savedWidgetPosition) {
        widget.style.setProperty('top', savedWidgetPosition.top, 'important');
        widget.style.setProperty('left', savedWidgetPosition.left, 'important');
    } else {
        widget.style.setProperty('bottom', '28px', 'important');
        widget.style.setProperty('right', '28px', 'important');
    }

    // Roast — always shown
    const roastEl = document.createElement('div');
    roastEl.style.cssText = [
        'font-size: 17px !important',
        'font-weight: 800 !important',
        'color: #e91e8c !important',
        'line-height: 1.35 !important',
        'letter-spacing: -0.2px !important',
        'min-height: 48px !important',
    ].join(';');
    roastEl.textContent = 'generating your roast...';
    widget.appendChild(roastEl);

    // Affirmation
    const affirmEl = document.createElement('div');
    affirmEl.style.cssText = [
        'font-size: 12px !important',
        'color: #888 !important',
        'font-style: italic !important',
        'line-height: 1.5 !important',
        'border-top: 1px solid #1f1f1f !important',
        'padding-top: 12px !important',
    ].join(';');
    affirmEl.textContent = affirmation;
    widget.appendChild(affirmEl);

    // Audio controls — always rendered, hidden when audio is disabled
    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = [
        'align-items:center !important',
        'gap:12px !important',
        settings.audioEnabled ? 'display:flex !important' : 'display:none !important',
    ].join(';');

    const playPauseBtn = document.createElement('button');
    playPauseBtn.textContent = '⏸';
    playPauseBtn.style.cssText = [
        'background: #e91e8c !important',
        'color: #fff !important',
        'border: none !important',
        'border-radius: 50% !important',
        'width: 40px !important',
        'height: 40px !important',
        'font-size: 16px !important',
        'cursor: pointer !important',
        'flex-shrink: 0 !important',
        'line-height: 1 !important',
        'box-shadow: 0 4px 12px rgba(233,30,140,0.4) !important',
    ].join(';');
    playPauseBtn.onclick = () => {
        if (!currentAudio) return;
        if (currentAudio.paused) {
            currentAudio.play();
            playPauseBtn.textContent = '⏸';
        } else {
            currentAudio.pause();
            playPauseBtn.textContent = '▶';
        }
    };

    const volIcon = document.createElement('span');
    volIcon.textContent = '🔊';
    volIcon.style.cssText = 'font-size:13px !important; flex-shrink:0 !important;';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.05';
    volSlider.value = String(settings.volume);
    volSlider.style.cssText = 'flex:1 !important; accent-color:#e91e8c !important; cursor:pointer !important; height:4px !important;';
    volSlider.oninput = () => {
        if (currentAudio) currentAudio.volume = parseFloat(volSlider.value);
    };

    controlsRow.appendChild(playPauseBtn);
    controlsRow.appendChild(volIcon);
    controlsRow.appendChild(volSlider);
    widget.appendChild(controlsRow);

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = dismissText;
    dismissBtn.style.cssText = [
        'background: #1a1a1a !important',
        'color: #666 !important',
        'border: 1px solid #2a2a2a !important',
        'border-radius: 10px !important',
        'padding: 10px !important',
        'width: 100% !important',
        'font-size: 12px !important',
        'font-weight: 600 !important',
        'cursor: pointer !important',
        'letter-spacing: 0.5px !important',
        'text-transform: lowercase !important',
        'font-family: inherit !important',
    ].join(';');
    dismissBtn.onclick = () => {
        if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
        widget.remove();
        widgetRefs = null;
    };

    widget.appendChild(dismissBtn);
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

    return (roast) => { roastEl.textContent = roast; };
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