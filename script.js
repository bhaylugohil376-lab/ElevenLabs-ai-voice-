/* =========================================================
   VOICEAI — MAIN SCRIPT
   ========================================================= */

"use strict";


/* =========================================================
   CONFIG
   ========================================================= */

const VOICEAI_CONFIG = {

    freeDailyLimit: 5,

    storageKey: "voiceai_usage",

    premiumStorageKey: "voiceai_premium",

    apiBase: "/api"

};


/* =========================================================
   DOM READY
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    initUsageSystem();

    initHeroGenerator();

    initVoicePreviewButtons();

    initDownloadButtons();

    initFileInputs();

    initMobileNavigation();

});


/* =========================================================
   USAGE SYSTEM
   ========================================================= */

function getUsageData() {

    const saved = localStorage.getItem(
        VOICEAI_CONFIG.storageKey
    );

    if (!saved) {

        return {
            date: getTodayKey(),
            count: 0
        };

    }

    try {

        const data = JSON.parse(saved);

        if (data.date !== getTodayKey()) {

            const fresh = {
                date: getTodayKey(),
                count: 0
            };

            localStorage.setItem(
                VOICEAI_CONFIG.storageKey,
                JSON.stringify(fresh)
            );

            return fresh;
        }

        return data;

    } catch (error) {

        const fresh = {
            date: getTodayKey(),
            count: 0
        };

        localStorage.setItem(
            VOICEAI_CONFIG.storageKey,
            JSON.stringify(fresh)
        );

        return fresh;
    }
}


function saveUsageData(data) {

    localStorage.setItem(
        VOICEAI_CONFIG.storageKey,
        JSON.stringify(data)
    );

}


function getTodayKey() {

    const now = new Date();

    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
    ].join("-");

}


/* =========================================================
   PREMIUM CHECK
   ========================================================= */

function isPremiumUser() {

    return localStorage.getItem(
        VOICEAI_CONFIG.premiumStorageKey
    ) === "true";

}


/*
 * IMPORTANT:
 * Client-side premium status is only for demo/UI.
 *
 * Real production premium access MUST be verified
 * on the backend after payment.
 */


/* =========================================================
   CHECK USAGE
   ========================================================= */

function canUseAI() {

    if (isPremiumUser()) {

        return true;
    }

    const usage = getUsageData();

    if (
        usage.count >=
        VOICEAI_CONFIG.freeDailyLimit
    ) {

        showToast(
            "Free limit reached. You have used 5 AI generations today."
        );

        return false;
    }

    return true;
}


/* =========================================================
   INCREASE USAGE
   ========================================================= */

function consumeAIUse() {

    if (isPremiumUser()) {

        return true;
    }

    const usage = getUsageData();

    usage.count += 1;

    saveUsageData(usage);

    updateUsageDisplay();

    return true;
}


/* =========================================================
   USAGE DISPLAY
   ========================================================= */

function updateUsageDisplay() {

    const elements =
        document.querySelectorAll(
            "[data-usage-count]"
        );

    const usage = getUsageData();

    elements.forEach((element) => {

        if (isPremiumUser()) {

            element.textContent =
                "Premium · Unlimited";

            return;
        }

        const remaining =
            Math.max(
                0,
                VOICEAI_CONFIG.freeDailyLimit -
                usage.count
            );

        element.textContent =
            `${remaining} free uses remaining today`;

    });

}


/* =========================================================
   INIT USAGE
   ========================================================= */

function initUsageSystem() {

    getUsageData();

    updateUsageDisplay();

}


/* =========================================================
   HERO GENERATOR
   ========================================================= */

function initHeroGenerator() {

    const button =
        document.querySelector(
            ".generate-ai-btn"
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        async () => {

            const text =
                document.querySelector(
                    "#heroText"
                );

            const voice =
                document.querySelector(
                    "#heroVoice"
                );

            if (!text || !voice) {
                return;
            }

            const value =
                text.value.trim();

            if (!value) {

                showToast(
                    "Please enter some text first."
                );

                text.focus();

                return;
            }

            if (!canUseAI()) {
                return;
            }

            button.disabled = true;

            button.textContent =
                "Generating...";

            try {

                const result =
                    await generateSpeech({
                        text: value,
                        voice: voice.value
                    });

                if (
                    result &&
                    result.success
                ) {

                    consumeAIUse();

                    showToast(
                        "Voice generated successfully."
                    );

                    if (result.audioUrl) {

                        createAudioResult(
                            result.audioUrl
                        );

                    }

                } else {

                    showToast(
                        result?.message ||
                        "Voice generation is not available yet."
                    );

                }

            } catch (error) {

                console.error(
                    "VoiceAI generation error:",
                    error
                );

                showToast(
                    "Unable to generate voice. Check your API connection."
                );

            } finally {

                button.disabled = false;

                button.textContent =
                    "Generate";

            }

        }
    );

}


/* =========================================================
   TTS API
   ========================================================= */

async function generateSpeech(payload) {

    /*
     * Production endpoint:
     *
     * POST /api/generate
     *
     * Expected JSON:
     * {
     *   text: "...",
     *   voice: "..."
     * }
     *
     * Expected response:
     * {
     *   success: true,
     *   audioUrl: "..."
     * }
     */

    const response =
        await fetch(
            `${VOICEAI_CONFIG.apiBase}/generate`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify(
                    payload
                )
            }
        );

    if (!response.ok) {

        throw new Error(
            `API error: ${response.status}`
        );

    }

    return await response.json();

}


/* =========================================================
   AUDIO RESULT
   ========================================================= */

function createAudioResult(
    audioUrl
) {

    let container =
        document.querySelector(
            "#voiceaiAudioResult"
        );

    if (!container) {

        container =
            document.createElement(
                "div"
            );

        container.id =
            "voiceaiAudioResult";

        container.style.marginTop =
            "15px";

        const generator =
            document.querySelector(
                ".hero-generator"
            );

        if (generator) {

            generator.appendChild(
                container
            );

        }

    }

    container.innerHTML = "";

    const audio =
        document.createElement(
            "audio"
        );

    audio.controls = true;

    audio.preload = "metadata";

    audio.src = audioUrl;

    audio.style.width =
        "100%";

    const download =
        document.createElement(
            "a"
        );

    download.href =
        audioUrl;

    download.download =
        "voiceai-generated-audio.mp3";

    download.className =
        "primary-btn";

    download.textContent =
        "Download Audio";

    download.style.marginTop =
        "10px";

    container.appendChild(
        audio
    );

    container.appendChild(
        download
    );

}


/* =========================================================
   VOICE PREVIEW
   ========================================================= */

function initVoicePreviewButtons() {

    const buttons =
        document.querySelectorAll(
            ".preview-voice"
        );

    buttons.forEach((button) => {

        button.addEventListener(
            "click",
            async () => {

                const card =
                    button.closest(
                        ".voice-card"
                    );

                if (!card) {
                    return;
                }

                const name =
                    card.querySelector(
                        "h3"
                    )?.textContent
                    ?.trim();

                if (!name) {
                    return;
                }

                const audioUrl =
                    button.dataset.audio;

                if (audioUrl) {

                    playVoicePreview(
                        audioUrl,
                        button
                    );

                    return;
                }

                /*
                 * If the voice card has no preview
                 * URL yet, show a clear message instead
                 * of pretending it is real.
                 */

                showToast(
                    `${name} preview will use the connected voice API.`
                );

            }
        );

    });

}


/* =========================================================
   PLAY PREVIEW
   ========================================================= */

let currentPreviewAudio = null;

function playVoicePreview(
    audioUrl,
    button
) {

    if (currentPreviewAudio) {

        currentPreviewAudio.pause();

        currentPreviewAudio.currentTime =
            0;

    }

    const audio =
        new Audio(audioUrl);

    currentPreviewAudio =
        audio;

    const oldText =
        button.textContent;

    button.textContent =
        "⏸ Playing...";

    audio.play()
        .catch(() => {

            showToast(
                "Unable to play voice preview."
            );

        });

    audio.addEventListener(
        "ended",
        () => {

            button.textContent =
                oldText;

        }
    );

}


/* =========================================================
   DOWNLOAD BUTTONS
   ========================================================= */

function initDownloadButtons() {

    document.addEventListener(
        "click",
        (event) => {

            const button =
                event.target.closest(
                    "[data-download]"
                );

            if (!button) {
                return;
            }

            const url =
                button.dataset.download;

            if (!url) {

                showToast(
                    "Download file is not ready."
                );

                return;
            }

            downloadFile(
                url,
                button.dataset.filename ||
                "voiceai-output"
            );

        }
    );

}


function downloadFile(
    url,
    filename
) {

    const link =
        document.createElement(
            "a"
        );

    link.href = url;

    link.download =
        filename;

    link.target = "_blank";

    document.body.appendChild(
        link
    );

    link.click();

    link.remove();

}


/* =========================================================
   FILE INPUTS
   ========================================================= */

function initFileInputs() {

    const inputs =
        document.querySelectorAll(
            'input[type="file"]'
        );

    inputs.forEach((input) => {

        input.addEventListener(
            "change",
            () => {

                if (
                    !input.files ||
                    !input.files.length
                ) {
                    return;
                }

                const file =
                    input.files[0];

                const maxSize =
                    200 * 1024 * 1024;

                if (
                    file.size > maxSize
                ) {

                    showToast(
                        "File is too large. Maximum size is 200MB."
                    );

                    input.value = "";

                    return;
                }

                showToast(
                    `${file.name} selected.`
                );

            }
        );

    });

}


/* =========================================================
   MOBILE NAVIGATION
   ========================================================= */

function initMobileNavigation() {

    /*
     * Main navigation uses separate HTML pages.
     * No SPA route replacement is used.
     *
     * This keeps:
     *
     * Home       -> index.html
     * Tools      -> tools.html
     * Voices     -> voices.html
     * Studio     -> studio.html
     * Pricing    -> pricing.html
     * About      -> about.html
     * FAQ        -> faq.html
     * Contact    -> contact.html
     * AI Video   -> video.html
     */

}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {

    let toast =
        document.querySelector(
            "#voiceaiToast"
        );

    if (!toast) {

        toast =
            document.createElement(
                "div"
            );

        toast.id =
            "voiceaiToast";

        Object.assign(
            toast.style,
            {
                position: "fixed",
                left: "50%",
                bottom: "25px",
                transform: "translateX(-50%)",
                zIndex: "99999",
                maxWidth: "90%",
                padding: "12px 18px",
                borderRadius: "10px",
                background: "#ffffff",
                color: "#08090d",
                fontSize: "13px",
                fontWeight: "700",
                boxShadow:
                    "0 15px 40px rgba(0,0,0,.35)",
                opacity: "0",
                pointerEvents: "none"
            }
        );

        document.body.appendChild(
            toast
        );

    }

    toast.textContent =
        message;

    toast.style.opacity =
        "1";

    clearTimeout(
        toast._timeout
    );

    toast._timeout =
        setTimeout(
            () => {

                toast.style.opacity =
                    "0";

            },
            3000
        );

}


/* =========================================================
   PUBLIC HELPERS
   ========================================================= */

window.VoiceAI = {

    canUseAI,

    consumeAIUse,

    getUsageData,

    isPremiumUser,

    showToast,

    generateSpeech,

    downloadFile

};
