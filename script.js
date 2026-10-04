/* =========================================
   VoiceAI - Main JavaScript
========================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* =====================================
       MOBILE MENU
    ===================================== */

    const navbar = document.querySelector(".navbar");
    const navLinks = document.querySelector(".nav-links");

    if (navbar && navLinks) {

        const menuButton = document.createElement("button");

        menuButton.className = "mobile-menu-btn";
        menuButton.innerHTML = "☰";
        menuButton.setAttribute("aria-label", "Open menu");

        navbar.insertBefore(menuButton, navLinks);

        menuButton.addEventListener("click", () => {
            navLinks.classList.toggle("mobile-open");

            if (navLinks.classList.contains("mobile-open")) {
                menuButton.innerHTML = "✕";
            } else {
                menuButton.innerHTML = "☰";
            }
        });

        navLinks.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                navLinks.classList.remove("mobile-open");
                menuButton.innerHTML = "☰";
            });
        });
    }


    /* =====================================
       TEXT TO SPEECH DEMO
    ===================================== */

    const generateButtons = document.querySelectorAll(
        ".primary-btn"
    );

    generateButtons.forEach(button => {

        const text = button.textContent.trim().toLowerCase();

        if (
            text.includes("generate voice") ||
            text === "generate"
        ) {

            button.addEventListener("click", () => {

                const textarea =
                    button.closest(".feature-card, .hero-generator")
                    ?.querySelector("textarea");

                if (!textarea || !textarea.value.trim()) {

                    alert("Please enter some text first.");

                    return;
                }

                button.disabled = true;
                const oldText = button.textContent;

                button.textContent = "Generating...";

                setTimeout(() => {

                    button.disabled = false;
                    button.textContent = oldText;

                    alert(
                        "Demo generation complete. Real AI generation API will be connected here."
                    );

                }, 1200);

            });
        }
    });


    /* =====================================
       VOICE SEARCH
    ===================================== */

    const voiceSearch =
        document.querySelector(".voice-search input");

    const voiceCards =
        document.querySelectorAll(".voice-card");

    if (voiceSearch && voiceCards.length) {

        voiceSearch.addEventListener("input", () => {

            const query =
                voiceSearch.value.toLowerCase().trim();

            voiceCards.forEach(card => {

                const content =
                    card.textContent.toLowerCase();

                card.style.display =
                    content.includes(query)
                        ? ""
                        : "none";

            });

        });
    }


    /* =====================================
       VOICE PREVIEW
    ===================================== */

    document.querySelectorAll(".voice-card button")
        .forEach(button => {

            button.addEventListener("click", () => {

                const card = button.closest(".voice-card");

                const voiceName =
                    card?.querySelector("h3")?.textContent
                    || "Voice";

                alert(
                    voiceName +
                    " preview will play here after the audio API is connected."
                );

            });

        });


    /* =====================================
       FILE INPUT
    ===================================== */

    document.querySelectorAll(
        'input[type="file"]'
    ).forEach(input => {

        input.addEventListener("change", () => {

            if (!input.files || !input.files.length) {
                return;
            }

            const fileName =
                input.files[0].name;

            const parent =
                input.parentElement;

            let fileText =
                parent.querySelector(".selected-file");

            if (!fileText) {

                fileText =
                    document.createElement("p");

                fileText.className =
                    "selected-file";

                fileText.style.marginTop =
                    "12px";

                fileText.style.color =
                    "#a78bfa";

                parent.appendChild(fileText);
            }

            fileText.textContent =
                "Selected: " + fileName;

        });

    });


    /* =====================================
       DUBBING
    ===================================== */

    const dubbingButton =
        document.querySelector(
            ".feature-card .primary-btn"
        );

    if (dubbingButton &&
        dubbingButton.textContent
            .toLowerCase()
            .includes("dubbing")) {

        dubbingButton.addEventListener("click", () => {

            alert(
                "Dubbing demo ready. Connect your dubbing API for real processing."
            );

        });

    }


    /* =====================================
       SPEECH TO TEXT RECORD BUTTON
    ===================================== */

    const recordButton =
        Array.from(
            document.querySelectorAll("button")
        ).find(button =>
            button.textContent
                .toLowerCase()
                .includes("start recording")
        );

    if (recordButton) {

        let recording = false;

        recordButton.addEventListener("click", () => {

            recording = !recording;

            if (recording) {

                recordButton.textContent =
                    "⏹ Stop Recording";

                recordButton.style.background =
                    "#dc2626";

            } else {

                recordButton.textContent =
                    "🎙 Start Recording";

                recordButton.style.background =
                    "";

            }

        });

    }


    /* =====================================
       AI AGENT CHAT DEMO
    ===================================== */

    const agentInput =
        document.querySelector(".agent-input input");

    const agentSend =
        document.querySelector(".agent-input button");

    const agentMessage =
        document.querySelector(".agent-message");

    if (
        agentInput &&
        agentSend &&
        agentMessage
    ) {

        agentSend.addEventListener("click", () => {

            const message =
                agentInput.value.trim();

            if (!message) {

                alert("Please type a message.");

                return;
            }

            agentMessage.textContent =
                "🤖 You said: " + message;

            agentInput.value = "";

        });

        agentInput.addEventListener(
            "keydown",
            event => {

                if (event.key === "Enter") {
                    agentSend.click();
                }

            }
        );

    }


    /* =====================================
       LOGIN DEMO
    ===================================== */

    const loginButton =
        document.querySelector(".login-card .primary-btn");

    if (loginButton) {

        loginButton.addEventListener("click", () => {

            const email =
                document.querySelector(
                    '.login-card input[type="email"]'
                );

            const password =
                document.querySelector(
                    '.login-card input[type="password"]'
                );

            if (!email?.value.trim()) {

                alert("Please enter your email.");

                return;
            }

            if (!password?.value.trim()) {

                alert("Please enter your password.");

                return;
            }

            alert(
                "Login UI is working. Connect your authentication backend here."
            );

        });

    }


    /* =====================================
       PREMIUM BUTTON
    ===================================== */

    document.querySelectorAll(
        ".price-card .primary-btn"
    ).forEach(button => {

        button.addEventListener("click", () => {

            alert(
                "Premium checkout will open here after payment integration."
            );

        });

    });


    /* =====================================
       SCROLL REVEAL
    ===================================== */

    const revealItems =
        document.querySelectorAll(
            ".tool-card, .voice-card, .price-card, .feature-card"
        );

    const revealObserver =
        new IntersectionObserver(
            entries => {

                entries.forEach(entry => {

                    if (entry.isIntersecting) {

                        entry.target.classList.add(
                            "visible"
                        );

                    }

                });

            },
            {
                threshold: 0.12
            }
        );

    revealItems.forEach(item => {
        revealObserver.observe(item);
    });


    /* =====================================
       CURRENT PAGE
    ===================================== */

    const currentPage =
        window.location.pathname
            .split("/")
            .pop() || "index.html";

    document.querySelectorAll(
        ".nav-links a"
    ).forEach(link => {

        const linkPage =
            link.getAttribute("href");

        if (linkPage === currentPage) {

            link.classList.add("active");

        }

    });

});

// ========================================
// VOICE LIBRARY
// ========================================

document.addEventListener("DOMContentLoaded", function () {

    const searchInput = document.getElementById("voiceSearch");
    const categorySelect = document.getElementById("voiceCategory");
    const voiceCards = document.querySelectorAll(".voice-card");
    const noVoices = document.getElementById("noVoices");

    function filterVoices() {

        if (!searchInput || !categorySelect) {
            return;
        }

        const search =
            searchInput.value.toLowerCase().trim();

        const category =
            categorySelect.value.toLowerCase();

        let visibleCount = 0;

        voiceCards.forEach(function (card) {

            const name =
                card.dataset.name.toLowerCase();

            const categories =
                card.dataset.category.toLowerCase();

            const searchMatch =
                name.includes(search) ||
                categories.includes(search);

            const categoryMatch =
                category === "all" ||
                categories.includes(category);

            if (searchMatch && categoryMatch) {

                card.style.display = "";

                visibleCount++;

            } else {

                card.style.display = "none";

            }

        });

        if (noVoices) {

            noVoices.hidden =
                visibleCount !== 0;

        }

    }

    if (searchInput) {
        searchInput.addEventListener(
            "input",
            filterVoices
        );
    }

    if (categorySelect) {
        categorySelect.addEventListener(
            "change",
            filterVoices
        );
    }


    // ========================================
    // BROWSER VOICE PREVIEW
    // ========================================

    const previewButtons =
        document.querySelectorAll(".preview-voice");

    const previewText =
        document.getElementById("previewText");

    let currentSpeech = null;


    previewButtons.forEach(function (button) {

        button.addEventListener("click", function () {

            if (!("speechSynthesis" in window)) {

                alert(
                    "Voice preview is not supported by this browser."
                );

                return;
            }

            const text =
                previewText
                    ? previewText.value.trim()
                    : "Welcome to VoiceAI.";

            if (!text) {

                alert("Please enter preview text.");

                return;
            }


            speechSynthesis.cancel();


            const utterance =
                new SpeechSynthesisUtterance(text);


            // Voice style approximation
            const voiceName =
                button.dataset.voice || "";


            if (voiceName === "Jerry B" ||
                voiceName === "Allison") {

                utterance.rate = 1.12;
                utterance.pitch = 1.08;

            } else if (voiceName === "Hale") {

                utterance.rate = 0.94;
                utterance.pitch = 0.92;

            } else if (voiceName === "David Castlemore") {

                utterance.rate = 0.88;
                utterance.pitch = 0.90;

            } else {

                utterance.rate = 1.0;
                utterance.pitch = 1.0;

            }


            currentSpeech = utterance;

            speechSynthesis.speak(utterance);

        });

    });


    // ========================================
    // USE VOICE
    // ========================================

    const useButtons =
        document.querySelectorAll(".select-voice");


    useButtons.forEach(function (button) {

        button.addEventListener("click", function () {

            const selectedVoice =
                button.dataset.voice;

            localStorage.setItem(
                "selectedVoice",
                selectedVoice
            );

            alert(
                selectedVoice +
                " selected successfully."
            );

        });

    });

});

