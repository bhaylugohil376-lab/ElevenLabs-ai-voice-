/* =========================================================
   VOICEFORGE AI
   Multilingual Browser Voice Engine
   ========================================================= */

const textInput = document.getElementById("textInput");
const counter = document.getElementById("counter");

const language = document.getElementById("language");
const voiceSelect = document.getElementById("voiceSelect");

const speed = document.getElementById("speed");

const generateBtn = document.getElementById("generateBtn");
const clearBtn = document.getElementById("clearBtn");

const audioPanel = document.getElementById("audioPanel");
const audioStatus = document.getElementById("audioStatus");

const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");

const themeBtn = document.getElementById("themeBtn");
const progressBar = document.getElementById("progressBar");

let voices = [];
let selectedVoice = null;
let speechTimer = null;


/* =========================
   TEXT COUNTER
   ========================= */

function updateCounter() {

  const length = textInput.value.length;

  counter.textContent = `${length} / 5000`;
}

textInput.addEventListener(
  "input",
  updateCounter
);


/* =========================
   LOAD BROWSER VOICES
   ========================= */

function loadVoices() {

  if (!("speechSynthesis" in window)) {

    voiceSelect.innerHTML = `
      <option>
        Browser speech not supported
      </option>
    `;

    return;
  }

  voices = speechSynthesis.getVoices();

  updateVoiceList();
}


function updateVoiceList() {

  const selectedLanguage =
    language.value.toLowerCase();

  voiceSelect.innerHTML = "";

  const matchingVoices =
    voices.filter(voice => {

      const voiceLang =
        voice.lang.toLowerCase();

      return (
        voiceLang === selectedLanguage ||
        voiceLang.startsWith(
          selectedLanguage.split("-")[0]
        )
      );
    });


  const available =
    matchingVoices.length
      ? matchingVoices
      : voices;


  if (!available.length) {

    voiceSelect.innerHTML = `
      <option value="">
        No voices available
      </option>
    `;

    return;
  }


  available.forEach(
    (voice, index) => {

      const option =
        document.createElement("option");

      option.value = voices.indexOf(voice);

      option.textContent =
        `${voice.name} (${voice.lang})`;

      voiceSelect.appendChild(option);

    }
  );


  selectedVoice = available[0];

  voiceSelect.value =
    voices.indexOf(selectedVoice);
}


/* Browser loads voices asynchronously */

if ("speechSynthesis" in window) {

  speechSynthesis.onvoiceschanged =
    loadVoices;
}

loadVoices();


/* =========================
   LANGUAGE CHANGE
   ========================= */

language.addEventListener(
  "change",
  updateVoiceList
);


/* =========================
   VOICE CHANGE
   ========================= */

voiceSelect.addEventListener(
  "change",
  () => {

    const index =
      Number(voiceSelect.value);

    selectedVoice =
      voices[index] || null;
  }
);


/* =========================
   SPEAK FUNCTION
   ========================= */

function speakText() {

  const text =
    textInput.value.trim();

  if (!text) {

    alert(
      "Please enter some text first."
    );

    textInput.focus();

    return;
  }


  if (!("speechSynthesis" in window)) {

    alert(
      "Your browser does not support text-to-speech."
    );

    return;
  }


  speechSynthesis.cancel();


  const utterance =
    new SpeechSynthesisUtterance(text);


  if (selectedVoice) {

    utterance.voice =
      selectedVoice;
  }


  utterance.lang =
    language.value;


  utterance.rate =
    Number(speed.value);


  utterance.pitch =
    1;


  utterance.volume =
    1;


  utterance.onstart = () => {

    audioPanel.classList.remove(
      "hidden"
    );

    audioStatus.textContent =
      "Speaking...";

    playBtn.textContent =
      "⏸";

    startProgress();
  };


  utterance.onend = () => {

    audioStatus.textContent =
      "Completed";

    playBtn.textContent =
      "▶";

    stopProgress();
  };


  utterance.onerror = () => {

    audioStatus.textContent =
      "Voice error";

    playBtn.textContent =
      "▶";

    stopProgress();
  };


  speechSynthesis.speak(
    utterance
  );
}


/* =========================
   GENERATE BUTTON
   ========================= */

generateBtn.addEventListener(
  "click",
  () => {

    generateBtn.classList.add(
      "loading"
    );

    generateBtn.innerHTML =
      "⏳ Generating...";


    setTimeout(() => {

      speakText();

      generateBtn.classList.remove(
        "loading"
      );

      generateBtn.innerHTML =
        "🔊 Generate Voice";

    }, 200);
  }
);


/* =========================
   PLAY BUTTON
   ========================= */

playBtn.addEventListener(
  "click",
  () => {

    if (
      speechSynthesis.speaking
    ) {

      speechSynthesis.pause();

      playBtn.textContent =
        "▶";

      audioStatus.textContent =
        "Paused";

      return;
    }


    if (
      speechSynthesis.paused
    ) {

      speechSynthesis.resume();

      playBtn.textContent =
        "⏸";

      audioStatus.textContent =
        "Speaking...";

      return;
    }


    speakText();
  }
);


/* =========================
   STOP
   ========================= */

stopBtn.addEventListener(
  "click",
  () => {

    speechSynthesis.cancel();

    playBtn.textContent =
      "▶";

    audioStatus.textContent =
      "Stopped";

    stopProgress();
  }
);


/* =========================
   CLEAR
   ========================= */

clearBtn.addEventListener(
  "click",
  () => {

    speechSynthesis.cancel();

    textInput.value = "";

    updateCounter();

    audioPanel.classList.add(
      "hidden"
    );

    playBtn.textContent =
      "▶";

    stopProgress();
  }
);


/* =========================
   PROGRESS ANIMATION
   ========================= */

function startProgress() {

  progressBar.style.width =
    "0%";

  clearInterval(
    speechTimer
  );

  let progress = 0;

  speechTimer =
    setInterval(() => {

      progress += 1;

      if (progress >= 100) {

        progress = 100;

        clearInterval(
          speechTimer
        );
      }

      progressBar.style.width =
        `${progress}%`;

    }, 100);
}


function stopProgress() {

  clearInterval(
    speechTimer
  );

  progressBar.style.width =
    "0%";
}


/* =========================
   DARK / LIGHT MODE
   ========================= */

themeBtn.addEventListener(
  "click",
  () => {

    document.body.classList.toggle(
      "light"
    );

    const light =
      document.body.classList.contains(
        "light"
      );

    themeBtn.textContent =
      light ? "🌙" : "☀️";

    localStorage.setItem(
      "voiceforge-theme",
      light ? "light" : "dark"
    );
  }
);


/* Restore theme */

const savedTheme =
  localStorage.getItem(
    "voiceforge-theme"
  );

if (savedTheme === "light") {

  document.body.classList.add(
    "light"
  );

  themeBtn.textContent =
    "🌙";
}


/* =========================
   INITIALIZE
   ========================= */

updateCounter();

console.log(
  "VoiceForge AI loaded successfully."
);
