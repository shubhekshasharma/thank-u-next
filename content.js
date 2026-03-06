console.log("content script loaded on Gmail!");

const emailSet = new Set();

// TODO: move these to environment variables
const OPEN_AI_LLM_URL = "";
const OPEN_AI_LLM_TOKEN = "";
// TODO: test different models to see which one is best for this use case
const OPEN_AI_LLM_MODEL = "GPT 4.1 Mini"; 

const rejectionKeywords = [
    "sorry", // TODO: this is pretty broad, might want to remove later after testing
    "we've decided to move forward with other candidates",
    "decided to move forward with other candidates",
    "move forward with another candidate",
    "moving forward with other candidates",
    "have not been selected",
    "not been selected to move forward",
    "chosen to move forward with another candidate",
    "we have selected another candidate",
    "regret to inform you",
    "did not work out",
    "won't be proceeding to the interview stage",
    "pursue other candidates",
    "we are moving forward with other candidates",
    "not selected for further consideration"
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


let timeout;
const observer = new MutationObserver(() => {
  clearTimeout(timeout);

  timeout = setTimeout(() => {

    const emailTitle = document.querySelector('.hP')?.innerText;
    const bodyText = document.querySelector('.a3s.aiL')?.innerText;

    const email =  document.querySelector('.gD')?.getAttribute('email')

    const emailKey = `${emailTitle}-${email}`;

    if (emailKey && emailSet.has(emailKey)) {
      return 
    }

    if (!bodyText) {
      return;
    }

    const lowerBodyText = bodyText.toLowerCase();

    emailSet.add(emailKey);
    const containsAny = rejectionKeywords.some(element => lowerBodyText.includes(element));

     if (!containsAny) { 
        console.log(`Not a rejection email from ${email}`)
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
        .then(
            res => res.json()
        )
        .then(data => {
            console.log('LLM response:', data);
            const roast = data.choices[0].message.content || "Sorry, couldn't come up with a roast this time!";
            console.log(`Roast for ${companyName}: ${roast}`);
        })
        .catch(err => {
            console.error('Error fetching roast:', err);
        });

    if (containsAny) { 
        console.log(`Rejection detected from ${email}`)
    }
   

  }, 500);
});


observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});