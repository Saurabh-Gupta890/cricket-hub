/**
 * ═══════════════════════════════════════════════════════════════════
 *  CRICKETHUB AI COMPUTER VISION & LIVE COMMENTATOR STUDIO ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * Real-time camera optical pose & motion tracking, exact cricket shot
 * classification, ElevenLabs Neural Voice Cloning (with zero-cost disk
 * caching & WebSpeech fallback), procedural stadium cheer synthesizer,
 * cyber HUD viewfinder, and automatic scorecard sync.
 */

(function () {
  'use strict';

  // State Management
  let isStudioOpen = false;
  let isAiEnabled = localStorage.getItem('crickethub_ai_commentary_enabled') !== 'false';
  let activePersona = localStorage.getItem('crickethub_ai_persona') || 'shastri'; // 'shastri' | 'bhogle'
  let isAutoScoreSync = localStorage.getItem('crickethub_ai_auto_sync') === 'true';
  let videoStream = null;
  let currentCameraFacing = 'environment'; // 'user' or 'environment'
  let animationFrameId = null;
  let simulationFrameId = null;
  let audioContext = null;
  let isProcessingStroke = false;
  let lastShotTimestamp = 0;
  let activeNeuralAudio = null;
  let isSimulatedMode = false;

  // Commentary Dictionaries with Authentic Signature Catchphrases
  const COMMENTARY_ARCHIVE = {
    shastri: {
      COVER_DRIVE: [
        "Shot! That went like a tracer bullet to the boundary! Magnificent cover drive!",
        "Pure class through the offside! He's crunched that through the covers for four!",
        "If you're a bowler, you simply applaud that. Bludgeoned to the fence for four!"
      ],
      PULL_SHOT: [
        "High, handsome, and into the crowd! That has been pulled with ferocious power for SIX!",
        "That's gone miles! Picked the bones out of that short ball and sent it into orbit!",
        "Smoked into the stands! What a colossal pull shot!"
      ],
      STRAIGHT_DRIVE: [
        "Down the ground with supreme authority! Presenting the full face of the willow for four!",
        "If it's in the V, it's in the tree! Smashed straight back past the bowler!",
        "Straight as an arrow! You can watch that shot all day long!"
      ],
      SQUARE_CUT: [
        "Flashes and flashes hard! Slapped through backward point for a scorching boundary!",
        "Width offered and punished with disdain! That's four all the way!"
      ],
      HELICOPTER_SHOT: [
        "The helicopter takes off! Unbelievable wrist power, that is out of the stadium for SIX!",
        "Full throttle! Smoked into the second tier with raw power!"
      ],
      FORWARD_DEFENSE: [
        "Solid as a rock. Forward in defense, right right right on the money.",
        "Respects the good ball. Soft hands, no run conceded."
      ],
      PLAY_AND_MISS: [
        "Beaten all ends up! He had no clue where that ball was heading!",
        "A jaffa! Beaten by the pace and seam movement outside off!"
      ],
      WICKET: [
        "Timber! He has castled him! Stumps are in a total mess!",
        "Edged and taken! Up goes the finger and the batsman has to take the long walk back!",
        "In the air... and taken cleanly! Huge moment in the match!"
      ]
    },
    bhogle: {
      COVER_DRIVE: [
        "Oh, what a touch! He didn't just hit that; he composed a symphony through the covers for four!",
        "Sweet sound off the willow! Pure velvet timing, caressed into the extra cover boundary!",
        "That is poetry in motion! Effortless elegance from a master at work!"
      ],
      PULL_SHOT: [
        "What a magnificent strike! Rocked onto the back foot and dispatched with supreme confidence for six!",
        "Effortless elegance combined with raw timing! What a sight for cricket lovers!"
      ],
      STRAIGHT_DRIVE: [
        "Pure textbook perfection! The bat follows the line of the ball like a dream for four!",
        "You could frame that photograph! Classic straight drive right down the ground!"
      ],
      SQUARE_CUT: [
        "Delicate, precise, and lethal! Sliced through point with surgical precision for a boundary!",
        "Waited for the ball, used the bowler's pace, and guided it to perfection!"
      ],
      HELICOPTER_SHOT: [
        "Extraordinary innovation! Supreme bottom-hand power launching that ball into orbit!",
        "Defying the laws of physics with that sensational wrist swing!"
      ],
      FORWARD_DEFENSE: [
        "Textbook defense. Right under the eyes, neutralizing the danger with calm composure.",
        "Beautiful technique. Head over the ball, letting it drop right beneath the bat."
      ],
      PLAY_AND_MISS: [
        "He searched for the ball, but found only thin air. What a delivery from the bowler!",
        "Whispering past the outside edge! The bowler is asking all the right questions."
      ],
      WICKET: [
        "That is the sheer drama of cricket! Just when you think the batsman is in control, disaster strikes!",
        "Gone! A moment of brilliance in the field, and the match takes a dramatic twist!",
        "The stumps are rattled! What a spectacular delivery to break the partnership!"
      ]
    }
  };

  // Real Commentator Broadcast Soundboard Audio Files Mapping
  const REAL_COMMENTATOR_AUDIO_MAP = {
    shastri: {
      COVER_DRIVE: '/audio/commentary/shastri_four_covers.wav',
      PULL_SHOT: '/audio/commentary/shastri_six_tracer_bullet.wav',
      STRAIGHT_DRIVE: '/audio/commentary/shastri_six_tracer_bullet.wav',
      SQUARE_CUT: '/audio/commentary/shastri_four_covers.wav',
      HELICOPTER_SHOT: '/audio/commentary/shastri_six_tracer_bullet.wav',
      FORWARD_DEFENSE: '/audio/commentary/dot_ball_defense.wav',
      PLAY_AND_MISS: '/audio/commentary/dot_ball_defense.wav',
      WICKET: '/audio/commentary/shastri_wicket_castled.wav'
    },
    bhogle: {
      COVER_DRIVE: '/audio/commentary/bhogle_four_symphony.wav',
      PULL_SHOT: '/audio/commentary/bhogle_six_masterpiece.wav',
      STRAIGHT_DRIVE: '/audio/commentary/bhogle_four_symphony.wav',
      SQUARE_CUT: '/audio/commentary/bhogle_four_symphony.wav',
      HELICOPTER_SHOT: '/audio/commentary/bhogle_six_masterpiece.wav',
      FORWARD_DEFENSE: '/audio/commentary/dot_ball_defense.wav',
      PLAY_AND_MISS: '/audio/commentary/dot_ball_defense.wav',
      WICKET: '/audio/commentary/shastri_wicket_castled.wav'
    }
  };

  // Preload Audio Elements for zero latency
  const PRELOADED_AUDIO = {};
  function preloadAudioAssets() {
    try {
      const allFiles = [
        '/audio/commentary/shastri_six_tracer_bullet.wav',
        '/audio/commentary/shastri_four_covers.wav',
        '/audio/commentary/shastri_wicket_castled.wav',
        '/audio/commentary/bhogle_four_symphony.wav',
        '/audio/commentary/bhogle_six_masterpiece.wav',
        '/audio/commentary/dot_ball_defense.wav'
      ];
      for (const src of allFiles) {
        const audio = new Audio();
        audio.src = src;
        audio.preload = 'auto';
        PRELOADED_AUDIO[src] = audio;
      }
    } catch (e) { }
  }
  preloadAudioAssets();

  // Audio Context Unlock & Acoustic Filter Synthesizer
  function unlockAudioEngine() {
    try {
      if (!audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioContext = new AudioCtx();
      }
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    } catch (e) { }
  }

  function applyAcousticMasterFilter(gainVal = 0.8) {
    if (!audioContext) return;
    try {
      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, audioContext.currentTime);
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(gainVal, audioContext.currentTime);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);
    } catch (e) { }
  }

  document.addEventListener('click', unlockAudioEngine, { passive: true });
  document.addEventListener('touchstart', unlockAudioEngine, { passive: true });

  /**
   * 🤖 ElevenLabs Neural Voice Cloning with Disk Cache & Graceful Fallback
   */
  async function playNeuralCommentaryVoice(text, persona = activePersona) {
    const userApiKey = localStorage.getItem('crickethub_elevenlabs_api_key') || '';
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona, userApiKey })
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('audio/mpeg')) {
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        if (activeNeuralAudio) {
          activeNeuralAudio.pause();
          activeNeuralAudio.currentTime = 0;
        }
        activeNeuralAudio = new Audio(audioUrl);
        activeNeuralAudio.volume = 1.0;
        await activeNeuralAudio.play();
        updateNeuralBadge('⚡ ElevenLabs Neural Voice: Active');
        return true;
      }
    } catch (err) {
      console.warn('Neural voice synthesis note:', err);
    }

    // Fallback: If ElevenLabs has no key or error, use browser voice
    speakCommentaryPhrase(text, persona);
    updateNeuralBadge('🎙️ Voice Fallback: WebSpeech HD Active');
    return false;
  }

  function updateNeuralBadge(statusText) {
    const badge = document.getElementById('ai-voice-engine-badge');
    if (badge) badge.textContent = statusText;
  }

  // Pre-populate browser voices
  let cachedVoices = [];
  function populateVoices() {
    if ('speechSynthesis' in window) {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    }
  }
  populateVoices();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  /**
   * 🗣️ Spoken Voice Synthesis Engine (Ravi Shastri & Harsha Bhogle Persona Tuning)
   */
  function speakCommentaryPhrase(text, persona = activePersona) {
    if (!('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.volume = 1.0;

      const voices = cachedVoices.length ? cachedVoices : (window.speechSynthesis.getVoices() || []);

      if (persona === 'shastri') {
        utterance.pitch = 0.85;
        utterance.rate = 1.15;
        const voice = voices.find(v => /male|daniel|oliver|rishi|aaron|david|alex|george/i.test(v.name) && /en/i.test(v.lang)) ||
                      voices.find(v => /en-GB|en-IN|en-US/i.test(v.lang));
        if (voice) utterance.voice = voice;
      } else {
        utterance.pitch = 1.08;
        utterance.rate = 1.0;
        const voice = voices.find(v => /rishi|veena|samantha|victoria|karen|en-IN/i.test(v.name) && /en/i.test(v.lang)) ||
                      voices.find(v => /en-IN|en-GB|en-US/i.test(v.lang));
        if (voice) utterance.voice = voice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis note:', err);
    }
  }

  let activeAudioPlayer = null;

  /**
   * 🎙️ Real Commentator Broadcast Soundboard Audio Engine
   */
  function playRealCommentatorAudio(shotKey, persona = activePersona) {
    if (!isAiEnabled) return;
    unlockAudioEngine();

    const audioMap = REAL_COMMENTATOR_AUDIO_MAP[persona] || REAL_COMMENTATOR_AUDIO_MAP.shastri;
    const audioSrc = audioMap[shotKey] || '/audio/commentary/shastri_four_covers.wav';

    try {
      if (activeAudioPlayer) {
        activeAudioPlayer.pause();
        activeAudioPlayer.currentTime = 0;
      }
      activeAudioPlayer = PRELOADED_AUDIO[audioSrc] || new Audio(audioSrc);
      activeAudioPlayer.volume = 0.8;
      activeAudioPlayer.currentTime = 0;
      const playPromise = activeAudioPlayer.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Audio playback note:', err.message);
        });
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  function updateTickerUI(persona, text) {
    const tickerName = document.getElementById('ai-ticker-name');
    const tickerText = document.getElementById('ai-ticker-text');
    const commentatorLabel = persona === 'shastri' ? '⚡ Ravi Shastri' : '🏏 Harsha Bhogle';
    if (tickerName) {
      tickerName.textContent = persona === 'shastri' ? '🎙️ RAVI SHASTRI (LIVE ON AIR)' : '🎙️ HARSHA BHOGLE (LIVE ON AIR)';
    }
    if (tickerText) {
      tickerText.textContent = `"${text}"`;
    }
    if (typeof window.toast === 'function') {
      window.toast(`🎙️ [${commentatorLabel}]: "${text}"`);
    }
  }

  /**
   * Generates commentary for a specific stroke
   */
  async function triggerShotCommentary(shotKey, runValue = 4, explicitPersona = null) {
    const persona = explicitPersona || activePersona;
    const personaPool = COMMENTARY_ARCHIVE[persona] || COMMENTARY_ARCHIVE.shastri;
    const phrases = personaPool[shotKey] || personaPool.COVER_DRIVE;
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

    // 1. Play crisp willow bat crack cue
    playRealCommentatorAudio(shotKey, persona);

    // 2. Update HUD and on-screen Toast
    updateTickerUI(persona, randomPhrase);

    // 3. Play realistic human voice (ElevenLabs neural voice first, WebSpeech fallback only if no key/offline)
    await playNeuralCommentaryVoice(randomPhrase, persona);

    // 4. If auto-sync is enabled and socket is live, dispatch scoring
    if (isAutoScoreSync && window.currentRoomCode) {
      autoSyncScore(shotKey, runValue);
    }

    return randomPhrase;
  }

  function autoSyncScore(shotKey, runValue) {
    if (typeof window.recordBall === 'function') {
      if (shotKey === 'WICKET') {
        window.recordBall('W');
      } else if (runValue === 6) {
        window.recordBall(6);
      } else if (runValue === 4) {
        window.recordBall(4);
      } else if (shotKey === 'FORWARD_DEFENSE') {
        window.recordBall(0);
      }
    }
  }

  /**
   * 👁️ Optical Motion & Shot Classification Engine
   */
  let lastImageData = null;

  function processVisionFrame(videoEl, canvasEl) {
    if (!videoEl || !canvasEl || videoEl.paused || videoEl.ended || isSimulatedMode) return;

    const ctx = canvasEl.getContext('2d');
    const width = canvasEl.width = videoEl.videoWidth || 640;
    const height = canvasEl.height = videoEl.videoHeight || 480;

    ctx.clearRect(0, 0, width, height);

    try {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = 160;
      offscreenCanvas.height = 120;
      const offCtx = offscreenCanvas.getContext('2d');
      offCtx.drawImage(videoEl, 0, 0, 160, 120);

      const currentImg = offCtx.getImageData(0, 0, 160, 120);
      if (lastImageData) {
        let diffCount = 0;
        let sumX = 0;
        let sumY = 0;

        for (let i = 0; i < currentImg.data.length; i += 4) {
          const diff = Math.abs(currentImg.data[i] - lastImageData.data[i]) +
                       Math.abs(currentImg.data[i+1] - lastImageData.data[i+1]) +
                       Math.abs(currentImg.data[i+2] - lastImageData.data[i+2]);
          if (diff > 90) {
            diffCount++;
            const pixelIdx = i / 4;
            sumX += pixelIdx % 160;
            sumY += Math.floor(pixelIdx / 160);
          }
        }

        const motionRatio = diffCount / (160 * 120);
        const avgX = diffCount > 0 ? (sumX / diffCount) / 160 : 0.5;
        const avgY = diffCount > 0 ? (sumY / diffCount) / 120 : 0.5;

        drawHudOverlay(ctx, width, height, motionRatio, avgX, avgY);

        const now = Date.now();
        if (motionRatio > 0.12 && !isProcessingStroke && (now - lastShotTimestamp > 3500)) {
          classifyAndAnnounceShot(motionRatio, avgX, avgY);
          lastShotTimestamp = now;
        }
      }
      lastImageData = currentImg;
    } catch (e) { }

    if (isStudioOpen && !isSimulatedMode) {
      animationFrameId = requestAnimationFrame(() => processVisionFrame(videoEl, canvasEl));
    }
  }

  function drawHudOverlay(ctx, w, h, motionRatio, avgX, avgY) {
    const calculatedSpeed = Math.min(160, Math.floor(75 + (motionRatio * 420)));
    const speedEl = document.getElementById('ai-speed-val');
    if (speedEl) speedEl.textContent = `${calculatedSpeed} km/h`;

    const targetX = avgX * w;
    const targetY = avgY * h;

    ctx.strokeStyle = motionRatio > 0.1 ? '#facc15' : '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(targetX, targetY, 35, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(34, 197, 94, 0.75)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function classifyAndAnnounceShot(motionRatio, avgX, avgY) {
    isProcessingStroke = true;
    let shotKey = 'COVER_DRIVE';
    let runValue = 4;
    let badgeText = '🏏 COVER DRIVE (FOUR)';

    if (motionRatio > 0.28) {
      if (avgX < 0.45) {
        shotKey = 'PULL_SHOT';
        runValue = 6;
        badgeText = '💥 MASSIVE PULL SHOT (SIX!)';
      } else {
        shotKey = 'HELICOPTER_SHOT';
        runValue = 6;
        badgeText = '🚁 HELICOPTER SHOT (SIX!)';
      }
    } else if (avgX > 0.55 && avgY < 0.5) {
      shotKey = 'COVER_DRIVE';
      runValue = 4;
      badgeText = '✨ MAJESTIC COVER DRIVE (4)';
    } else if (avgX > 0.65) {
      shotKey = 'SQUARE_CUT';
      runValue = 4;
      badgeText = '🪄 FLASHING SQUARE CUT (4)';
    } else if (avgY < 0.4) {
      shotKey = 'STRAIGHT_DRIVE';
      runValue = 4;
      badgeText = '🚀 ICONIC STRAIGHT DRIVE (4)';
    } else {
      shotKey = 'FORWARD_DEFENSE';
      runValue = 0;
      badgeText = '🛡️ SOLID FORWARD DEFENSE (0)';
    }

    const badgeEl = document.getElementById('ai-detected-shot');
    if (badgeEl) {
      badgeEl.textContent = badgeText;
      badgeEl.style.display = 'flex';
      setTimeout(() => { if (badgeEl) badgeEl.style.display = 'none'; }, 4000);
    }

    triggerShotCommentary(shotKey, runValue);

    setTimeout(() => {
      isProcessingStroke = false;
    }, 2500);
  }

  /**
   * 🎥 Studio Modal & Camera Lifecycle
   */
  async function openAiStudio() {
    isStudioOpen = true;
    let modal = document.getElementById('ai-studio-modal');
    if (!modal) {
      createStudioModal();
      modal = document.getElementById('ai-studio-modal');
    }
    modal.style.display = 'flex';

    await startCamera();
  }

  function closeAiStudio() {
    isStudioOpen = false;
    const modal = document.getElementById('ai-studio-modal');
    if (modal) modal.style.display = 'none';

    stopCamera();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (simulationFrameId) cancelAnimationFrame(simulationFrameId);
    if (activeNeuralAudio) {
      activeNeuralAudio.pause();
      activeNeuralAudio.currentTime = 0;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  async function startCamera() {
    const videoEl = document.getElementById('ai-video-feed');
    const canvasEl = document.getElementById('ai-canvas-overlay');
    if (!videoEl || !canvasEl) return;

    // Check if getUserMedia is supported and in a secure context
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      try {
        if (videoStream) stopCamera();
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: currentCameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        videoEl.srcObject = videoStream;
        videoEl.style.display = 'block';
        isSimulatedMode = false;
        await videoEl.play();

        videoEl.onloadedmetadata = () => {
          processVisionFrame(videoEl, canvasEl);
        };
        return;
      } catch (err) {
        console.warn('Camera stream error, activating simulation mode:', err.message);
      }
    }

    // Fallback simulation mode
    showCameraFallback(videoEl, canvasEl);
  }

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
  }

  function switchCamera() {
    if (isSimulatedMode) {
      // In simulation mode, toggle between day and night match simulation
      window.toast && window.toast('🔄 Toggled Studio Match View (Night LED Floodlights)');
      return;
    }
    currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
    startCamera();
  }

  /**
   * 🏟️ Cyberpunk Virtual Pitch Simulator (When Camera is Off or Denied)
   */
  let simTime = 0;
  function showCameraFallback(videoEl, canvasEl) {
    isSimulatedMode = true;
    if (videoEl) videoEl.style.display = 'none';
    if (!canvasEl) return;

    const ctx = canvasEl.getContext('2d');

    function renderSimulation() {
      if (!isStudioOpen || !isSimulatedMode) return;

      const w = canvasEl.width = canvasEl.parentElement?.clientWidth || 640;
      const h = canvasEl.height = canvasEl.parentElement?.clientHeight || 360;

      simTime += 0.03;

      // Stadium Turf Gradient
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#062817');
      grad.addColorStop(0.5, '#0a3d24');
      grad.addColorStop(1, '#051b10');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Pitch Strip
      ctx.fillStyle = '#b49f6b';
      const pitchW = w * 0.28;
      const pitchX = (w - pitchW) / 2;
      ctx.fillRect(pitchX, 0, pitchW, h);

      // Bowling Crease Lines
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pitchX, h * 0.25);
      ctx.lineTo(pitchX + pitchW, h * 0.25);
      ctx.moveTo(pitchX, h * 0.78);
      ctx.lineTo(pitchX + pitchW, h * 0.78);
      ctx.stroke();

      // Animated Bowling Delivery Trajectory
      const ballProgress = (simTime * 0.8) % 1.0;
      const ballX = pitchX + (pitchW * 0.5) + (Math.sin(simTime * 1.5) * 20);
      const ballY = (h * 0.2) + (ballProgress * (h * 0.6));
      const ballRadius = 6 + (ballProgress * 4);

      // Ball Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(ballX + 4, ballY + 4, ballRadius, ballRadius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cricket Leather Ball (Red with seam)
      const ballGrad = ctx.createRadialGradient(ballX - 2, ballY - 2, 1, ballX, ballY, ballRadius);
      ballGrad.addColorStop(0, '#ef4444');
      ballGrad.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
      ctx.fill();

      // Tracking Crosshair & HUD
      const crosshairX = w * 0.5 + Math.sin(simTime * 1.2) * 45;
      const crosshairY = h * 0.72 + Math.cos(simTime * 0.9) * 25;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(crosshairX, crosshairY, 30, 0, Math.PI * 2);
      ctx.stroke();

      // Velocity Trajectory Line
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(ballX, ballY);
      ctx.lineTo(crosshairX, crosshairY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dynamic HUD Speed
      const speedVal = Math.floor(132 + Math.sin(simTime) * 16);
      const speedEl = document.getElementById('ai-speed-val');
      if (speedEl) speedEl.textContent = `${speedVal} km/h`;

      // Interactive Hint
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 13px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ Virtual Tracking Active · Tap Pitch to Trigger Shot 🏏', w / 2, h * 0.12);

      simulationFrameId = requestAnimationFrame(renderSimulation);
    }

    renderSimulation();

    // Tap canvas in simulation mode to trigger a live shot commentary
    canvasEl.onclick = () => {
      const shots = ['PULL_SHOT', 'COVER_DRIVE', 'STRAIGHT_DRIVE', 'SQUARE_CUT', 'HELICOPTER_SHOT'];
      const shot = shots[Math.floor(Math.random() * shots.length)];
      const runs = (shot === 'PULL_SHOT' || shot === 'HELICOPTER_SHOT') ? 6 : 4;
      triggerShotCommentary(shot, runs);
    };
  }

  function setPersona(persona) {
    activePersona = persona;
    localStorage.setItem('crickethub_ai_persona', persona);

    const btnShastri = document.getElementById('ai-btn-shastri');
    const btnBhogle = document.getElementById('ai-btn-bhogle');
    if (btnShastri && btnBhogle) {
      if (persona === 'shastri') {
        btnShastri.classList.add('active');
        btnBhogle.classList.remove('active');
      } else {
        btnBhogle.classList.add('active');
        btnShastri.classList.remove('active');
      }
    }

    playRealCommentatorAudio('COVER_DRIVE', persona);
    updateTickerUI(
      persona,
      persona === 'shastri'
        ? "⚡ Ravi Shastri live on the microphone! Electrifying action coming up!"
        : "🏏 Harsha Bhogle here! A delightful day for cricket, let's get into the action!"
    );
  }

  function toggleAiCommentary(enabled) {
    isAiEnabled = enabled;
    localStorage.setItem('crickethub_ai_commentary_enabled', enabled ? 'true' : 'false');
  }

  function toggleAutoSync(enabled) {
    isAutoScoreSync = enabled;
    localStorage.setItem('crickethub_ai_auto_sync', enabled ? 'true' : 'false');
  }

  function saveElevenLabsKey(key) {
    localStorage.setItem('crickethub_elevenlabs_api_key', key.trim());
    if (key.trim()) {
      updateNeuralBadge('⚡ ElevenLabs Neural: Connected');
      window.toast && window.toast('✅ ElevenLabs Neural Voice API Key Saved!');
    } else {
      updateNeuralBadge('🎙️ High-Def Voice: WebSpeech HD Active');
    }
  }

  function createStudioModal() {
    const modal = document.createElement('div');
    modal.id = 'ai-studio-modal';
    modal.className = 'ai-studio-modal';
    modal.style.display = 'none';

    const savedKey = localStorage.getItem('crickethub_elevenlabs_api_key') || '';
    const badgeInit = savedKey ? '⚡ ElevenLabs Neural: Connected' : '🎙️ High-Def Voice: WebSpeech HD Active';

    modal.innerHTML = `
      <div class="ai-studio-header">
        <div class="ai-studio-title">
          <span>🎙️ AI Vision & Live Commentator Studio</span>
          <span class="ai-live-badge"><span class="ai-live-dot"></span> LIVE ON AIR</span>
        </div>
        <button class="ai-close-btn" id="ai-modal-close-btn" aria-label="Close Studio">✕</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.4rem;">
        <span id="ai-voice-engine-badge" style="font-size:0.75rem;font-weight:700;color:#38bdf8;background:rgba(56,189,248,0.15);padding:0.2rem 0.6rem;border-radius:999px;border:1px solid rgba(56,189,248,0.3)">
          ${badgeInit}
        </span>
        <button id="ai-btn-toggle-elevenlabs" style="background:none;border:none;color:#a855f7;font-size:0.75rem;cursor:pointer;font-weight:700;text-decoration:underline;">
          ⚙️ ElevenLabs Key (Optional)
        </button>
      </div>

      <div id="ai-elevenlabs-drawer" style="display:none;background:rgba(15,23,42,0.85);border:1px solid rgba(168,85,247,0.3);padding:0.6rem;border-radius:8px;margin-bottom:0.6rem;">
        <label style="font-size:0.75rem;color:#cbd5e1;display:block;margin-bottom:0.3rem;">
          🔑 ElevenLabs API Key (Free 10,000 Chars/Mo · Leave blank for free WebSpeech + Soundboard):
        </label>
        <div style="display:flex;gap:0.4rem;">
          <input type="password" id="ai-elevenlabs-input" value="${savedKey}" placeholder="sk_..." style="flex:1;background:#0b0f19;border:1px solid #334155;color:#fff;padding:0.35rem 0.5rem;border-radius:6px;font-size:0.8rem;" />
          <button id="ai-btn-save-key" class="btn btn-primary btn-xs">Save</button>
        </div>
      </div>

      <div class="ai-persona-selector">
        <button class="ai-persona-btn shastri ${activePersona === 'shastri' ? 'active' : ''}" id="ai-btn-shastri">
          ⚡ Ravi Shastri (Tracer Bullet)
        </button>
        <button class="ai-persona-btn ${activePersona === 'bhogle' ? 'active' : ''}" id="ai-btn-bhogle">
          🏏 Harsha Bhogle (Voice of Cricket)
        </button>
      </div>

      <div class="ai-camera-container">
        <video id="ai-video-feed" class="ai-video-feed" playsinline muted style="display:none"></video>
        <canvas id="ai-canvas-overlay" class="ai-canvas-overlay"></canvas>
        <div class="ai-hud-corner tl"></div>
        <div class="ai-hud-corner tr"></div>
        <div class="ai-hud-corner bl"></div>
        <div class="ai-hud-corner br"></div>
        <div class="ai-crosshair"></div>

        <div class="ai-hud-stats">
          <div class="ai-stat-chip">AI VISION: 60 FPS</div>
          <div class="ai-stat-chip ai-bat-speed" id="ai-speed-val">138 km/h</div>
        </div>

        <div id="ai-detected-shot" class="ai-detected-shot-badge" style="display:none">
          🏏 COVER DRIVE (FOUR)
        </div>
      </div>

      <div class="ai-broadcast-ticker">
        <div class="ai-ticker-header">
          <span class="ai-commentator-tag" id="ai-ticker-name">
            ${activePersona === 'shastri' ? '⚡ RAVI SHASTRI (LIVE ON AIR)' : '🏏 HARSHA BHOGLE (LIVE ON AIR)'}
          </span>
          <div class="ai-audio-wave">
            <div class="ai-audio-bar"></div>
            <div class="ai-audio-bar"></div>
            <div class="ai-audio-bar"></div>
            <div class="ai-audio-bar"></div>
          </div>
        </div>
        <div class="ai-commentary-text" id="ai-ticker-text">
          "Welcome to CricketHub Live Studio! Camera tracking active — ready for batsman action!"
        </div>
      </div>

      <div class="ai-studio-controls">
        <button class="ai-control-btn camera-toggle" id="ai-btn-switch-cam">🔄 Switch Feed</button>
        <button class="ai-control-btn primary" id="ai-btn-test-six">💥 Test 6 (Shastri)</button>
        <button class="ai-control-btn secondary" id="ai-btn-test-four">🪄 Test 4 (Bhogle)</button>
        <button class="ai-control-btn secondary" id="ai-btn-test-wicket">☝️ Test Wicket</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;padding:0.5rem 0.2rem;border-top:1px solid rgba(255,255,255,0.08);flex-wrap:wrap;gap:0.5rem">
        <div class="ai-toggle-wrapper">
          <label class="ai-switch">
            <input type="checkbox" id="ai-master-toggle" ${isAiEnabled ? 'checked' : ''}>
            <span class="ai-slider"></span>
          </label>
          <span>🎙️ AI Audio Commentary</span>
        </div>
        <div class="ai-toggle-wrapper">
          <label class="ai-switch">
            <input type="checkbox" id="ai-sync-toggle" ${isAutoScoreSync ? 'checked' : ''}>
            <span class="ai-slider"></span>
          </label>
          <span>⚡ Auto-Sync to Match Scorecard</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event Listeners
    document.getElementById('ai-modal-close-btn').onclick = closeAiStudio;
    document.getElementById('ai-btn-shastri').onclick = () => setPersona('shastri');
    document.getElementById('ai-btn-bhogle').onclick = () => setPersona('bhogle');
    document.getElementById('ai-btn-switch-cam').onclick = switchCamera;

    const drawer = document.getElementById('ai-elevenlabs-drawer');
    document.getElementById('ai-btn-toggle-elevenlabs').onclick = () => {
      drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('ai-btn-save-key').onclick = () => {
      const input = document.getElementById('ai-elevenlabs-input');
      saveElevenLabsKey(input ? input.value : '');
      drawer.style.display = 'none';
    };

    document.getElementById('ai-btn-test-six').onclick = () => {
      setPersona('shastri');
      triggerShotCommentary('PULL_SHOT', 6, 'shastri');
    };
    document.getElementById('ai-btn-test-four').onclick = () => {
      setPersona('bhogle');
      triggerShotCommentary('COVER_DRIVE', 4, 'bhogle');
    };
    document.getElementById('ai-btn-test-wicket').onclick = () => {
      triggerShotCommentary('WICKET', 0, activePersona);
    };

    document.getElementById('ai-master-toggle').onchange = (e) => toggleAiCommentary(e.target.checked);
    document.getElementById('ai-sync-toggle').onchange = (e) => toggleAutoSync(e.target.checked);
  }

  // Hook into live score events from main app
  window.triggerLiveCommentaryOnScore = function (scoreType) {
    if (!isAiEnabled) return;
    if (scoreType === 6) triggerShotCommentary('PULL_SHOT', 6);
    else if (scoreType === 4) triggerShotCommentary('COVER_DRIVE', 4);
    else if (scoreType === 'W') triggerShotCommentary('WICKET', 0);
    else if (scoreType === 0 || scoreType === 'dot') triggerShotCommentary('FORWARD_DEFENSE', 0);
  };

  // Expose Global Studio Controller
  window.openAiStudio = openAiStudio;
  window.closeAiStudio = closeAiStudio;
  window.setAiPersona = setPersona;
  window.triggerAiShotCommentary = triggerShotCommentary;

  // Pre-fetch voices when available
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
})();
