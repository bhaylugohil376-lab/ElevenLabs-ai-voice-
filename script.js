/* =========================================================
   VoiceAI — Main JavaScript
   File: script.js
   ========================================================= */

"use strict";

/* =========================================================
   DOM READY
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initLucide();
  initNavbar();
  initHeroGenerator();
  initAgent();
  initToolCards();
  initTextareaCounter();
});


/* =========================================================
   LUCIDE ICONS
========================================================= */

function initLucide() {
  if (window.lucide) {
    lucide.createIcons();
  }
}


/* =========================================================
   NAVBAR
========================================================= */

function initNavbar() {

  const currentPage =
    window.location.pathname
      .split("/")
      .pop()
      .toLowerCase() || "index.html";

  document
    .querySelectorAll(".nav-links a")
    .forEach((link) => {

      const href =
        link.getAttribute("href");

      if (!href) return;

      const page =
        href.split("/")
          .pop()
          .toLowerCase();

      link.classList.toggle(
        "active",
        page === currentPage
      );
    });
}


/* =========================================================
   HERO TEXT TO SPEECH
========================================================= */

function initHeroGenerator() {

  const button =
    document.getElementById("heroGenerateBtn");

  const textarea =
    document.getElementById("heroText");

  const voice =
    document.getElementById("heroVoice");

  if (!button || !textarea) {
    return;
  }

  button.addEventListener("click", () => {

    const text =
      textarea.value.trim();

    if (!text) {

      textarea.focus();

      showToast(
        "Please enter your script first."
      );

      return;
    }

    if (!voice || !voice.value) {

      showToast(
        "Please select a voice."
      );

      return;
    }

    /*
     * Homepage preview.
     * Real generation happens inside tts.html
     * through the protected /api/tts endpoint.
     */

    sessionStorage.setItem(
      "voiceai_tts_text",
      text
    );

    sessionStorage.setItem(
      "voiceai_tts_voice",
      voice.value
    );

    window.location.href =
      "tts.html";
  });
}


/* =========================================================
   AI AGENT
========================================================= */

function initAgent() {

  const button =
    document.getElementById("agentSendBtn");

  const input =
    document.getElementById("agentInput");

  if (!button || !input) {
    return;
  }

  function openAgent() {

    const message =
      input.value.trim();

    if (!message) {

      input.focus();

      return;
    }

    sessionStorage.setItem(
      "voiceai_agent_message",
      message
    );

    window.location.href =
      "agents.html";
  }

  button.addEventListener(
    "click",
    openAgent
  );

  input.addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Enter") {

        event.preventDefault();

        openAgent();
      }
    }
  );
}


/* =========================================================
   TOOL CARDS
========================================================= */

function initToolCards() {

  document
    .querySelectorAll(".tool-card")
    .forEach((card) => {

      card.addEventListener(
        "click",
        () => {

          const href =
            card.getAttribute("href");

          if (!href) {
            return;
          }

          card.classList.add(
            "tool-opening"
          );

        }
      );
    });
}


/* =========================================================
   TEXTAREA COUNTER
========================================================= */

function initTextareaCounter() {

  const textarea =
    document.getElementById("heroText");

  if (!textarea) {
    return;
  }

  const maxLength = 5000;

  textarea.setAttribute(
    "maxlength",
    maxLength
  );

  const generatorBody =
    textarea.closest(
      ".generator-body"
    );

  if (!generatorBody) {
    return;
  }

  const counter =
    document.createElement("div");

  counter.className =
    "text-counter";

  counter.style.cssText = `
    text-align:right;
    margin-top:6px;
    color:#526984;
    font-size:10px;
  `;

  textarea.insertAdjacentElement(
    "afterend",
    counter
  );

  function updateCounter() {

    counter.textContent =
      `${textarea.value.length}/${maxLength}`;
  }

  textarea.addEventListener(
    "input",
    updateCounter
  );

  updateCounter();
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {

  let toast =
    document.getElementById(
      "voiceai-toast"
    );

  if (!toast) {

    toast =
      document.createElement("div");

    toast.id =
      "voiceai-toast";

    toast.style.cssText = `
      position:fixed;
      left:50%;
      bottom:30px;
      transform:translateX(-50%) translateY(20px);
      z-index:9999;

      max-width:90%;
      padding:13px 18px;

      color:#eaf4ff;
      background:#0b172d;

      border:1px solid rgba(96,165,250,.30);
      border-radius:12px;

      box-shadow:0 15px 40px rgba(0,0,0,.45);

      font-size:13px;
      font-weight:600;

      opacity:0;
      pointer-events:none;

      transition:
        opacity .25s ease,
        transform .25s ease;
    `;

    document.body.appendChild(toast);
  }

  toast.textContent =
    message;

  toast.style.opacity =
    "1";

  toast.style.transform =
    "translateX(-50%) translateY(0)";

  clearTimeout(
    window.voiceaiToastTimer
  );

  window.voiceaiToastTimer =
    setTimeout(() => {

      toast.style.opacity =
        "0";

      toast.style.transform =
        "translateX(-50%) translateY(20px)";

    }, 2800);
}


/* =========================================================
   SESSION HELPERS
========================================================= */

window.VoiceAI = {

  save(key, value) {

    sessionStorage.setItem(
      `voiceai_${key}`,
      value
    );
  },

  get(key) {

    return sessionStorage.getItem(
      `voiceai_${key}`
    );
  },

  remove(key) {

    sessionStorage.removeItem(
      `voiceai_${key}`
    );
  },

  toast(message) {

    showToast(message);
  }

};


/* =========================================================
   FINAL ICON REFRESH
========================================================= */

setTimeout(() => {

  if (window.lucide) {
    lucide.createIcons();
  }

}, 100);
