/* =========================================================
   VOICEAI — FINAL SCRIPT
   Frontend demo / UI logic
   ========================================================= */

"use strict";


/* =========================================================
   DAILY FREE USAGE
   Free users: 5 AI actions per 24-hour period
   ========================================================= */

const FREE_DAILY_LIMIT = 5;

const USAGE_KEY = "voiceai_daily_usage";
const USAGE_DATE_KEY = "voiceai_usage_date";


function getTodayKey() {
    const now = new Date();

    return (
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0")
    );
}


function resetUsageIfNeeded() {

    const today = getTodayKey();

    const savedDate =
        localStorage.getItem(USAGE_DATE_KEY);

    if (savedDate !== today) {

        localStorage.setItem(
            USAGE_DATE_KEY,
            today
        );

        localStorage.setItem(
            USAGE_KEY,
            "0"
        );
    }
}


function getDailyUsage() {

    resetUsageIfNeeded();

    return Number(
        localStorage.getItem(USAGE_KEY) || "0"
    );
}


function getRemainingFreeUses() {

    return Math.max(
        0,
        FREE_DAILY_LIMIT - getDailyUsage()
    );
}


function canUseFreeAI() {

    resetUsageIfNeeded();

    const usage = getDailyUsage();

    if (usage >= FREE_DAILY_LIMIT) {

        showToast(
            "Daily free limit reached. 5 uses are available every 24 hours."
        );

        return false;
    }

    return true;
}


function recordFreeAIUse() {

    resetUsageIfNeeded();

    const usage = getDailyUsage();

    localStorage.setItem(
        USAGE_KEY,
        String(usage + 1)
    );

    updateUsageDisplay();
}


function updateUsageDisplay() {

    const remaining =
        getRemainingFreeUses();

    document
        .querySelectorAll("[data-free-uses]")
        .forEach(element => {

            element.textContent =
                remaining;
        });
}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {

    let toast =
        document.getElementById(
            "voiceaiToast"
        );

    if (!toast) {

        toast =
            document.createElement("div");

        toast.id =
            "voiceaiToast";

        toast.style.position =
            "fixed";

        toast.style.left =
            "50%";

        toast.style.bottom =
            "25px";

        toast.style.transform =
            "translateX(-50%)";

        toast.style.zIndex =
            "99999";

        toast.style.padding =
            "13px 18px";

        toast.style.borderRadius =
            "10px";

        toast.style.background =
            "#171920";

        toast.style.border =
            "1px solid #343741";

        toast.style.color =
            "#ffffff";

        toast.style.fontSize =
            "13px";

        toast.style.boxShadow =
            "0 15px 50px rgba(0,0,0,.4)";

        document.body.appendChild(
            toast
        );
    }

    toast.textContent =
        message;

    toast.style.opacity =
        "1";

    clearTimeout(
        toast._timer
    );

    toast._timer =
        setTimeout(() => {

            toast.style.opacity =
                "0";

        }, 3000);
}


/* =========================================================
   AI ACTION HANDLER
   ========================================================= */

function runFreeAIAction(
    callback
) {

    if (!canUseFreeAI()) {
        return;
    }

    recordFreeAIUse();

    if (typeof callback === "function") {
        callback();
    }
}


/* =========================================================
   DEMO GENERATION
   ========================================================= */

function simulateGeneration(button) {

    if (!canUseFreeAI()) {
        return;
    }

    recordFreeAIUse();

    const originalText =
        button.textContent;

    button.disabled = true;

    button.textContent =
        "Generating...";

    setTimeout(() => {

        button.disabled =
            false;

        button.textContent =
            originalText;

        showToast(
            "Demo generation completed successfully."
        );

    }, 1500);
}


/* =========================================================
   VOICE PREVIEW
   Browser SpeechSynthesis demo
   ========================================================= */

let currentSpeech = null;


function previewVoice(text, voiceName) {

    if (
        !("speechSynthesis" in window)
    ) {

        showToast(
            "Voice preview is not supported in this browser."
        );

        return;
    }

    window.speechSynthesis.cancel();

    const speech =
        new SpeechSynthesisUtterance(
            text
        );

    speech.rate = 0.95;
    speech.pitch = 1;
    speech.volume = 1;

    const voices =
        window.speechSynthesis
            .getVoices();

    const matchedVoice =
        voices.find(
            voice =>
                voice.name
                    .toLowerCase()
                    .includes(
                        String(
                            voiceName || ""
                        ).toLowerCase()
                    )
        );

    if (matchedVoice) {
        speech.voice =
            matchedVoice;
    }

    currentSpeech =
        speech;

    window.speechSynthesis
        .speak(speech);
}


/* =========================================================
   MOBILE / INTERNAL PAGE LINKS
   ========================================================= */

function setupPageLinks() {

    document
        .querySelectorAll(
            'a[href^="#"]'
        )
        .forEach(link => {

            link.addEventListener(
                "click",
                function (event) {

                    const targetId =
                        this.getAttribute(
                            "href"
                        );

                    if (
                        !targetId ||
                        targetId === "#"
                    ) {
                        return;
                    }

                    const target =
                        document.querySelector(
                            targetId
                        );

                    if (!target) {
                        return;
                    }

                    event.preventDefault();

                    target.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });

                }
            );

        });
}


/* =========================================================
   CONTACT FORM
   ========================================================= */

function setupContactForm() {

    const form =
        document.getElementById(
            "contactForm"
        );

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        function (event) {

            event.preventDefault();

            const status =
                document.getElementById(
                    "contactStatus"
                );

            if (status) {

                status.textContent =
                    "Message saved in this demo. Connect your backend/email API for real delivery.";

            }

            form.reset();

            showToast(
                "Message submitted."
            );

        }
    );
}


/* =========================================================
   GENERATE BUTTONS
   ========================================================= */

function setupGenerateButtons() {

    document
        .querySelectorAll(
            ".generate-ai-btn, .generate-voice-btn, .generate-audio-btn"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    simulateGeneration(
                        this
                    );

                }
            );

        });
}


/* =========================================================
   VOICE PREVIEW BUTTONS
   ========================================================= */

function setupVoicePreview() {

    document
        .querySelectorAll(
            ".preview-voice, [data-preview-voice]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    const card =
                        this.closest(
                            ".voice-card"
                        );

                    const nameElement =
                        card
                            ? card.querySelector(
                                "h3"
                            )
                            : null;

                    const voiceName =
                        nameElement
                            ? nameElement.textContent
                            : "";

                    const text =
                        "Hello, welcome to VoiceAI. This is a voice preview.";

                    previewVoice(
                        text,
                        voiceName
                    );

                }
            );

        });
}


/* =========================================================
   FILE INPUT FEEDBACK
   ========================================================= */

function setupFileInputs() {

    document
        .querySelectorAll(
            'input[type="file"]'
        )
        .forEach(input => {

            input.addEventListener(
                "change",
                function () {

                    if (
                        !this.files ||
                        !this.files.length
                    ) {
                        return;
                    }

                    showToast(
                        "Selected: " +
                        this.files[0].name
                    );

                }
            );

        });
}


/* =========================================================
   STUDIO SIDEBAR
   ========================================================= */

function setupStudio() {

    document
        .querySelectorAll(
            ".studio-sidebar button"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    document
                        .querySelectorAll(
                            ".studio-sidebar button"
                        )
                        .forEach(item => {

                            item.classList
                                .remove(
                                    "active"
                                );

                        });

                    this.classList
                        .add("active");

                    showToast(
                        this.textContent.trim() +
                        " tool selected."
                    );

                }
            );

        });
}


/* =========================================================
   DUBBING DEMO
   ========================================================= */

function setupDubbing() {

    document
        .querySelectorAll(
            ".dubbing-btn"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    simulateGeneration(
                        this
                    );

                }
            );

        });
}


/* =========================================================
   RECORDING DEMO
   ========================================================= */

let recording = false;


function setupRecording() {

    document
        .querySelectorAll(
            ".record-btn"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    if (!recording) {

                        if (
                            !canUseFreeAI()
                        ) {
                            return;
                        }

                        recording =
                            true;

                        this.textContent =
                            "■ Stop Recording";

                        showToast(
                            "Recording started."
                        );

                    } else {

                        recording =
                            false;

                        recordFreeAIUse();

                        this.textContent =
                            "🎙 Start Recording";

                        showToast(
                            "Recording stopped."
                        );
                    }

                }
            );

        });
}


/* =========================================================
   PAGE READY
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        resetUsageIfNeeded();

        updateUsageDisplay();

        setupPageLinks();

        setupContactForm();

        setupGenerateButtons();

        setupVoicePreview();

        setupFileInputs();

        setupStudio();

        setupDubbing();

        setupRecording();

    }
);
