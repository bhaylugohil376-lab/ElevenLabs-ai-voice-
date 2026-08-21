// ==========================================================================
// VoiceForge AI — Web Speech API & Application Controller
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Speech Synthesis API
  const synth = window.speechSynthesis;

  // DOM Elements
  const textInput = document.getElementById('textInput');
  const counter = document.getElementById('counter');
  const languageSelect = document.getElementById('language');
  const voiceSelect = document.getElementById('voiceSelect');
  const speedSelect = document.getElementById('speed');
  const pitchInput = document.getElementById('pitch');
  const pitchValue = document.getElementById('pitchValue');

  const generateBtn = document.getElementById('generateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const themeBtn = document.getElementById('themeBtn');

  const audioPanel = document.getElementById('audioPanel');
  const audioStatus = document.getElementById('audioStatus');
  const playBtn = document.getElementById('playBtn');
  const progressBar = document.getElementById('progressBar');
  const historyList = document.getElementById('historyList');

  let voices = [];
  let historyData = [];

  // 1. Text Area Character Counter
  if (textInput && counter) {
    textInput.addEventListener('input', () => {
      counter.textContent = `${textInput.value.length} / 5000`;
    });
  }

  // 2. Pitch Range Slider Display Update
  if (pitchInput && pitchValue) {
    pitchInput.addEventListener('input', () => {
      pitchValue.textContent = pitchInput.value;
    });
  }

  // 3. Load & Filter Web Speech Voices
  function populateVoiceList() {
    if (!synth) return;
    voices = synth.getVoices();
    const selectedLang = languageSelect.value;

    voiceSelect.innerHTML = '';

    const filteredVoices = voices.filter(voice => voice.lang.startsWith(selectedLang));

    if (filteredVoices.length === 0) {
      // Fallback: show all voices if selected language voice not found
      voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.setAttribute('data-index', index);
        voiceSelect.appendChild(option);
      });
    } else {
      filteredVoices.forEach((voice) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.setAttribute('data-index', voices.indexOf(voice));
        voiceSelect.appendChild(option);
      });
    }
  }

  populateVoiceList();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  languageSelect.addEventListener('change', populateVoiceList);

  // 4. Generate Voice & Playback
  generateBtn.addEventListener('click', () => {
    const text = textInput.value.trim();

    if (!text) {
      alert('Kripya speech me convert karne ke liye text enter karein.');
      return;
    }

    if (synth.speaking) {
      synth.cancel(); // Stop ongoing playback
    }

    const utterThis = new SpeechSynthesisUtterance(text);
    const selectedIndex = voiceSelect.selectedOptions[0]?.getAttribute('data-index');

    if (selectedIndex !== null && voices[selectedIndex]) {
      utterThis.voice = voices[selectedIndex];
    }

    utterThis.rate = parseFloat(speedSelect.value) || 1;
    utterThis.pitch = parseFloat(pitchInput.value) || 1;

    // UI Updates on Start
    audioPanel.classList.remove('hidden');
    audioStatus.textContent = 'Speaking...';
    playBtn.textContent = '⏸';
    progressBar.style.width = '0%';

    // Speech Events
    utterThis.onboundary = (event) => {
      if (event.charIndex) {
        const progress = (event.charIndex / text.length) * 100;
        progressBar.style.width = `${progress}%`;
      }
    };

    utterThis.onend = () => {
      audioStatus.textContent = 'Finished';
      playBtn.textContent = '▶';
      progressBar.style.width = '100%';
      addToHistory(text, languageSelect.value);
    };

    utterThis.onerror = () => {
      audioStatus.textContent = 'Error during synthesis';
      playBtn.textContent = '▶';
    };

    synth.speak(utterThis);
  });

  // 5. Play / Pause Toggle Button
  playBtn.addEventListener('click', () => {
    if (synth.speaking) {
      if (synth.paused) {
        synth.resume();
        playBtn.textContent = '⏸';
        audioStatus.textContent = 'Speaking...';
      } else {
        synth.pause();
        playBtn.textContent = '▶';
        audioStatus.textContent = 'Paused';
      }
    }
  });

  // 6. Clear Input Button
  clearBtn.addEventListener('click', () => {
    textInput.value = '';
    counter.textContent = '0 / 5000';
    if (synth.speaking) synth.cancel();
    audioPanel.classList.add('hidden');
  });

  // 7. Theme Toggle (Dark/Light Mode)
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      themeBtn.textContent = document.body.classList.contains('light-theme') ? '🌙' : '☀️';
    });
  }

  // 8. History Item Management
  function addToHistory(text, lang) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    historyData.unshift({ text, lang, time });

    if (historyData.length > 5) historyData.pop(); // Keep last 5 entries

    renderHistory();
  }

  function renderHistory() {
    if (!historyList) return;

    if (historyData.length === 0) {
      historyList.innerHTML = '<p class="empty-msg">No generated audio yet.</p>';
      return;
    }

    historyList.innerHTML = historyData.map((item) => `
      <div class="history-item" style="background: var(--bg-card); padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted);">
          <span>LANG: ${item.lang.toUpperCase()}</span>
          <span>${item.time}</span>
        </div>
        <p style="margin: 0.5rem 0; font-size: 0.95rem;">"${item.text.length > 80 ? item.text.substring(0, 80) + '...' : item.text}"</p>
      </div>
    `).join('');
  }
});
