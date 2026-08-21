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

let audio = null;
let audioUrl = null;
let voices = [];


/* =========================
   CHARACTER COUNTER
========================= */

textInput.addEventListener("input", () => {
  counter.textContent =
    `${textInput.value.length} / 5000`;
});


/* =========================
   LOAD ELEVENLABS VOICES
========================= */

async function loadVoices() {

  voiceSelect.innerHTML =
    `<option value="">Loading voices...</option>`;

  try {

    const response =
      await fetch("/api/voices");

    if (!response.ok) {
      throw new Error("Voice API unavailable");
    }

    const data =
      await response.json();

    voices = data.voices || [];

    voiceSelect.innerHTML = "";

    if (!voices.length) {

      voiceSelect.innerHTML =
        `<option value="">
          No voices available
        </option>`;

      return;
    }

    voices.forEach((voice) => {

      const option =
        document.createElement("option");

      option.value =
        voice.voice_id;

      option.textContent =
        voice.name;

      voiceSelect.appendChild(option);

    });

  } catch (error) {

    console.error(error);

    /*
      Fallback voice IDs.
      Replace these with your own ElevenLabs
      voice IDs when needed.
    */

    voiceSelect.innerHTML = `
      <option value="">
        Select an ElevenLabs voice
      </option>
    `;

  }
}


/* =========================
   GENERATE REAL AUDIO
========================= */

generateBtn.addEventListener(
  "click",
  async () => {

    const text =
      textInput.value.trim();

    const voiceId =
      voiceSelect.value;


    if (!text) {

      alert(
        "Please enter some text first."
      );

      textInput.focus();

      return;
    }


    if (!voiceId) {

      alert(
        "Please select a voice."
      );

      return;
    }


    generateBtn.disabled = true;

    generateBtn.innerHTML =
      "⏳ Generating...";


    audioPanel.classList.remove(
      "hidden"
    );

    audioStatus.textContent =
      "Generating AI voice...";


    try {

      const response =
        await fetch(
          "/api/generate",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({

              text: text,

              voiceId: voiceId,

              modelId:
                "eleven_multilingual_v2"

            })
          }
        );


      if (!response.ok) {

        let message =
          "Voice generation failed.";

        try {

          const error =
            await response.json();

          message =
            error.error || message;

        } catch {}

        throw new Error(message);
      }


      const blob =
        await response.blob();


      if (!blob.size) {

        throw new Error(
          "No audio was returned."
        );
      }


      if (audioUrl) {
        URL.revokeObjectURL(
          audioUrl
        );
      }


      audioUrl =
        URL.createObjectURL(
          blob
        );


      audio =
        new Audio(audioUrl);


      audioStatus.textContent =
        "Voice generated successfully";


      playBtn.textContent =
        "▶";


      audio.addEventListener(
        "timeupdate",
        updateProgress
      );


      audio.addEventListener(
        "ended",
        () => {

          playBtn.textContent =
            "▶";

          progressBar.style.width =
            "0%";

        }
      );


    } catch (error) {

      console.error(error);

      audioStatus.textContent =
        "Generation failed";

      alert(error.message);

    } finally {

      generateBtn.disabled =
        false;

      generateBtn.innerHTML =
        "🔊 Generate Voice";

    }

  }
);


/* =========================
   PLAY / PAUSE
========================= */

playBtn.addEventListener(
  "click",
  () => {

    if (!audio) {

      alert(
        "Generate a voice first."
      );

      return;
    }


    if (audio.paused) {

      audio.play();

      playBtn.textContent =
        "⏸";

      audioStatus.textContent =
        "Playing...";

    } else {

      audio.pause();

      playBtn.textContent =
        "▶";

      audioStatus.textContent =
        "Paused";

    }

  }
);


/* =========================
   STOP
========================= */

stopBtn.addEventListener(
  "click",
  () => {

    if (!audio) return;

    audio.pause();

    audio.currentTime = 0;

    playBtn.textContent =
      "▶";

    audioStatus.textContent =
      "Stopped";

    progressBar.style.width =
      "0%";
  }
);


/* =========================
   PROGRESS
========================= */

function updateProgress() {

  if (!audio || !audio.duration)
    return;

  const percent =
    (audio.currentTime /
      audio.duration) * 100;

  progressBar.style.width =
    `${percent}%`;
}


/* =========================
   DOWNLOAD MP3
========================= */

const downloadBtn =
  document.getElementById(
    "downloadBtn"
  );


if (downloadBtn) {

  downloadBtn.addEventListener(
    "click",
    () => {

      if (!audioUrl) {

        alert(
          "Generate a voice first."
        );

        return;
      }


      const link =
        document.createElement("a");

      link.href =
        audioUrl;

      link.download =
        "voiceforge-ai.mp3";

      document.body.appendChild(
        link
      );

      link.click();

      link.remove();

    }
  );
}


/* =========================
   CLEAR
========================= */

clearBtn.addEventListener(
  "click",
  () => {

    textInput.value = "";

    counter.textContent =
      "0 / 5000";

    if (audio) {

      audio.pause();

      audio.currentTime = 0;

    }

    if (audioUrl) {

      URL.revokeObjectURL(
        audioUrl
      );

      audioUrl = null;

    }

    audio = null;

    audioPanel.classList.add(
      "hidden"
    );

    progressBar.style.width =
      "0%";

  }
);


/* =========================
   DARK / LIGHT MODE
========================= */

themeBtn.addEventListener(
  "click",
  () => {

    document.body.classList.toggle(
      "light"
    );

    const isLight =
      document.body.classList.contains(
        "light"
      );

    themeBtn.textContent =
      isLight ? "🌙" : "☀️";

    localStorage.setItem(
      "voiceforge-theme",
      isLight
        ? "light"
        : "dark"
    );

  }
);


if (
  localStorage.getItem(
    "voiceforge-theme"
  ) === "light"
) {

  document.body.classList.add(
    "light"
  );

  themeBtn.textContent =
    "🌙";
}


/* =========================
   START
========================= */

loadVoices();
