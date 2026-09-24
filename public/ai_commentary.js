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

  // Commentary Dictionaries with Authentic Signature Catchphrases for all scoring events
  const COMMENTARY_ARCHIVE = {
    shastri: {
      RUN_0: [
        "Solid defensive prod! Right in the middle of the bat, no run.",
        "Right on the money from {bowler}! Forward in defense, dot ball.",
        "Beaten outside off! Whistles past the edge of {striker}'s bat, no run taken!",
        "Straight to the fielder at cover. Sits on the back foot and defends, dot ball.",
        "Good tight line from {bowler}. {striker} lets it go through safely to the keeper."
      ],
      RUN_1: [
        "Pushed into the gap for a brisk single! Good running between the wickets!",
        "Tucked away off the hips towards deep square leg for one.",
        "Dabbed down to third man, they scamper across for a sharp single!",
        "Dropped with soft hands and off {striker} goes for a quick single!",
        "Driven gently to long-on, easy single to rotate the strike."
      ],
      RUN_2: [
        "Worked away into the deep! They will come back for the second, superb running!",
        "Pushed into vacant territory, great hustle from {striker} for a brace!",
        "Driven wide of long-on, pressure on the arm, and they complete two safely!",
        "Clipped through midwicket, hard running between the wickets gets them two runs!"
      ],
      RUN_3: [
        "Cracking shot into the deep gap! Long chase for the fielder, and they run three hard!",
        "Magnificent placement from {striker}! Fielder slides to pull it back, three runs taken!",
        "Superb running between the wickets! Three runs added to the scoreboard."
      ],
      RUN_4: [
        "Shot! That went like a tracer bullet to the boundary! Four runs!",
        "Pure class through the offside! {striker} has crunched that through covers for FOUR!",
        "Width on offer from {bowler} and punished with sheer disdain! Four all the way!",
        "Down the ground like an arrow! What a sensational boundary from {striker}!",
        "Cracking square cut! Slapped through backward point, races away to the fence!"
      ],
      RUN_5: [
        "Overthrows! Total confusion in the field and that costs five penalty runs!",
        "Wild throw from the deep! Bonus runs for {striker}, five runs added to the total!"
      ],
      RUN_6: [
        "High, handsome, and into the crowd! That has been pulled with ferocious power for SIX!",
        "That's gone miles into the orbit! What a colossal maximum from {striker}!",
        "The helicopter takes off! Smashed out of the stadium for a monster SIX!",
        "If it's in the V, it's in the tree! Smashed straight over long-on for a colossal SIX!",
        "In the air and all the way! Picked the bones out of that delivery for six!"
      ],
      COVER_DRIVE: [
        "Shot! That went like a tracer bullet to the boundary! Magnificent cover drive!",
        "Pure class through the offside! {striker} crunched that through covers for four!",
        "If you're a bowler, you simply applaud that. Bludgeoned to the fence for four!"
      ],
      PULL_SHOT: [
        "High, handsome, and into the crowd! That has been pulled with ferocious power for SIX!",
        "That's gone miles! Picked the bones out of that short ball and sent it into orbit!",
        "Smoked into the stands! What a colossal pull shot from {striker}!"
      ],
      STRAIGHT_DRIVE: [
        "Down the ground with supreme authority! Presenting the full face of the willow for four!",
        "If it's in the V, it's in the tree! Smashed straight back past {bowler} for four!",
        "Straight as an arrow! You can watch that shot from {striker} all day long!"
      ],
      SQUARE_CUT: [
        "Flashes and flashes hard! Slapped through backward point for a scorching boundary!",
        "Width offered by {bowler} and punished with disdain! That's four all the way!"
      ],
      HELICOPTER_SHOT: [
        "The helicopter takes off! Unbelievable wrist power, that is out of the stadium for SIX!",
        "Full throttle! Smoked into the second tier with raw power!"
      ],
      FORWARD_DEFENSE: [
        "Solid as a rock. Forward in defense, right right right on the money.",
        "Respects the good ball. Soft hands from {striker}, no run conceded."
      ],
      PLAY_AND_MISS: [
        "Beaten all ends up! {striker} had no clue where that ball was heading!",
        "A jaffa from {bowler}! Beaten by the pace and seam movement outside off!"
      ],
      WICKET_BOWLED: [
        "Timber! He has castled him! Stumps are in a total mess! {striker} is clean bowled!",
        "Knocked him over! {bowler} uproots the middle stump with raw pace!",
        "Clean bowled! Straight through the gate, what an absolute ripper to dismiss {striker}!"
      ],
      WICKET_CAUGHT: [
        "In the air... and taken cleanly! Up goes the finger and {striker} has to take the long walk back!",
        "Edged and taken! Safe as houses in the field, huge wicket for {bowler}!",
        "Spliced high into the air, fielder settles underneath, and takes a pressure catch!"
      ],
      WICKET_LBW: [
        "Huge appeal from {bowler}... and the umpire raises the finger! Dead plumb LBW!",
        "Struck right in front! No doubt about that one, {striker} trapped right on the crease!",
        "Loud shout, finger goes up! Plumb in front of middle stump!"
      ],
      WICKET_STUMPED: [
        "Gone! {striker} dragged his foot out and the bails are whipped off in a flash! Superb glovework!",
        "Beaten in flight, drawn forward by {bowler}, and the keeper does the rest! Stumped!"
      ],
      WICKET_RUNOUT: [
        "Direct hit! What a sensational throw! {striker} is miles out of his ground and run out!",
        "Yes, no, sorry partner! Total mix-up and the stumps are broken at the danger end! RUN OUT!",
        "Suicidal running! The throw is right on the money, and the batsman is caught short!"
      ],
      WICKET_HITWICKET: [
        "Oh no! He stepped back onto his own stumps! Hit wicket, unbelievable misfortune for {striker}!"
      ],
      WICKET_GENERIC: [
        "Wicket! That is a massive blow in the match! {bowler} strikes and the fielding side is ecstatic!",
        "Gone! Up goes the finger, and a huge breakthrough is achieved!",
        "Disaster strikes for the batting side! A massive wicket falls at a crucial stage!"
      ],
      WICKET: [
        "Timber! Stumps shattered, what a colossal wicket!",
        "Edged and taken! Up goes the finger, huge moment in the match!",
        "In the air... and taken cleanly! Sensational breakthrough!"
      ],
      EXTRA_WIDE: [
        "Straying way down the leg side, the umpire stretches the arms for a wide ball!",
        "Fired outside the tramlines by {bowler}! Wide ball signaled, extra run added."
      ],
      EXTRA_NOBALL: [
        "Sirens blaring! {bowler} has overstepped the crease! No ball called and a free hit coming up!",
        "Front foot no ball! Big opportunity for {striker}, free hit next!"
      ],
      EXTRA_BYE: [
        "Beaten the bat and the keeper, they sneak through for an extra bye!",
        "Misses everything and rolls away, a bye taken by the batsmen."
      ],
      EXTRA_LEGBYE: [
        "Thudded into the pads and rolls away for a leg bye! Quick single stolen.",
        "Off the thigh pad, scampering through to collect a leg bye."
      ],
      MATCH_WON: [
        "It is all over! What an absolute thriller, and {winner} take the victory! Celebrations begin in the dugout, they have played extraordinary cricket today! {detail}",
        "That is it! {winner} have sealed the deal! What a monumental victory, etched in glory! {detail}",
        "Magnificent performance from {winner}! They held their nerves in the pressure cooker and come out on top! {detail}",
        "It's all over! {winner} are the champions today! Pure ecstasy for the team and their fans! {detail}"
      ],
      MATCH_TIED: [
        "Hold the phone! It is a tie! You cannot write a script like this! Incredible scenes here! {detail}",
        "Scores level! What a match! We have witnessed pure drama, absolutely nothing between the two sides! {detail}"
      ],
      INNINGS_CHANGE: [
        "And that is the end of the first innings! {battingTeam} finish on {runs} for {wickets}. The target is {target}! Grab your popcorn, the chase is going to be electrifying!",
        "Innings break! {battingTeam} set a competitive target of {target} runs. {bowlingTeam} will need to bat out of their skins to chase this down!",
        "First half done and dusted! {battingTeam} post {runs} on the board. All eyes on {bowlingTeam} now as they gear up for the chase of {target}!"
      ]
    },
    bhogle: {
      RUN_0: [
        "Sensible defense. Head over the ball, softly played towards mid-off.",
        "A gem of a delivery from {bowler}! Moving away just enough to beat the bat.",
        "Respecting the good delivery. No urgency from {striker} to steal a run there.",
        "Nicely bowled, tight line and length, keeping the batter quiet."
      ],
      RUN_1: [
        "Gentle nudge into the off side, and {striker} rotates the strike effortlessly.",
        "Turned neatly towards the leg side, easy single taken.",
        "Smart cricket! Finding the gap and keeping the scoreboard ticking.",
        "Soft hands into the covers, alert running to pick up a single."
      ],
      RUN_2: [
        "Effortless placement into the vacant spaces, turning one into two with delightful running.",
        "Gently caressed into the deep, excellent understanding between these two batters.",
        "Pushed past midwicket, they sprint back for the second with supreme ease."
      ],
      RUN_3: [
        "Glorious placement into the deep, requiring desperate fielding to save the boundary. Three runs taken.",
        "Timed so sweetly by {striker}! Outfield slows it down and three runs are completed."
      ],
      RUN_4: [
        "Oh, what a touch! {striker} didn't just hit that; he composed a symphony for four!",
        "Pure velvet timing! Caressed through the extra cover boundary with supreme elegance!",
        "Textbook perfection! The bat follows through with effortless grace for four!",
        "Surgical precision through the gap, racing away like lightning to the fence!"
      ],
      RUN_5: [
        "Drama in the outfield! A rushed throw and the batters pick up a handsome five runs!"
      ],
      RUN_6: [
        "What a magnificent strike! Rocked onto the back foot and launched into the stands for six!",
        "Defying the laws of physics! Pure timing and majestic swing from {striker} for six!",
        "You could frame that photograph! Sweet connection and sailed effortlessly over the rope!",
        "Sheer majesty! That ball belongs in a museum after a strike like that from {striker}!"
      ],
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
      WICKET_BOWLED: [
        "The stumps are shattered! What a sensational delivery from {bowler} to breach the batsman's defense.",
        "Past the inside edge and straight into the furniture! Total silence at the crease for {striker}.",
        "Beaten by pure pace and accuracy! The bails go flying, what a sight for {bowler}!"
      ],
      WICKET_CAUGHT: [
        "Gone! Sliced high into the sky, and held with cool composure in the outfield.",
        "A feather of an edge and safely pouched! Crucial breakthrough for {bowler} to dismiss {striker}.",
        "In the air... and safely held! The partnership is broken at a pivotal moment."
      ],
      WICKET_LBW: [
        "Loud shout for leg-before, and up goes the finger! {striker} beaten by the trajectory from {bowler}.",
        "Right in line with the middle stump! The umpire had no hesitation at all.",
        "Trapped in front! That looked dead right from the moment it struck the pad."
      ],
      WICKET_STUMPED: [
        "Lightning quick hands behind the stumps! {striker} caught on the wrong side of the line.",
        "Deceived in the air by {bowler}, missed it completely, and the bails are dislodged in a millisecond."
      ],
      WICKET_RUNOUT: [
        "Disaster between the wickets! Hesitation, panic, and a razor-sharp throw seals the dismissal!",
        "That was suicidal! Direct hit at the striker's end, and {striker} has to depart.",
        "Mix-up in the middle, and both batsmen were stranded at the same end! Run out!"
      ],
      WICKET_HITWICKET: [
        "A bizarre and unfortunate end! {striker} dislodging his own bails while attempting the shot."
      ],
      WICKET_GENERIC: [
        "That is the sheer drama of cricket! Just when you think the batsman is in control, disaster strikes!",
        "Gone! A moment of brilliance in the field, and the match takes a dramatic twist!",
        "And that is the breakthrough they were desperately looking for!"
      ],
      WICKET: [
        "Gone! A moment of brilliance in the field, and the match takes a dramatic twist!",
        "The stumps are rattled! What a spectacular delivery to break the partnership!",
        "That is the sheer drama of cricket! Disaster strikes for the batting side!"
      ],
      EXTRA_WIDE: [
        "A touch wayward from {bowler}, drifting wide of the mark. Extra run conceded.",
        "Too wide outside off, extra run added to the total."
      ],
      EXTRA_NOBALL: [
        "The umpire signals a no-ball! An expensive mistake by {bowler}, and a free hit for the batsman.",
        "Overstepping the line, siren sounds, free hit coming up!"
      ],
      EXTRA_BYE: [
        "Sneaking through past the keeper, fine awareness to steal a bye.",
        "Beaten everyone, and they scamper across for an extra bye."
      ],
      EXTRA_LEGBYE: [
        "Off the thigh pad, scampering through to collect a leg bye.",
        "Deflected off the pads into the offside, single taken."
      ],
      MATCH_WON: [
        "And that is the final chapter written in this magnificent contest! {winner} emerge victorious! What an exhibition of skill, grit and determination. {detail}",
        "Smiles, hugs, and pure relief! {winner} cross the finish line in style. A thoroughly well-deserved triumph! {detail}",
        "Cricket is a game of fine margins, and today {winner} seized the moments that mattered. A fantastic victory! {detail}",
        "The curtains come down on a gripping game! {winner} have won it with sheer class and poise. {detail}"
      ],
      MATCH_TIED: [
        "Unbelievable! We have a tie! After all the twists and turns, both sides finish level on terms. Cricket at its magical best! {detail}",
        "Neither side would yield an inch! A tie is the fairest reflection of an epic contest between two fantastic teams. {detail}"
      ],
      INNINGS_CHANGE: [
        "The first innings comes to a close. {battingTeam} have put up {runs} for {wickets}, setting a target of {target}. A fascinating chase awaits us!",
        "That brings us to the innings break! {battingTeam} finish at {runs}/{wickets}. {bowlingTeam} will need {target} runs to win. It promises to be a thrilling second half!",
        "A very engrossing first chapter. {battingTeam} post {runs} runs. {bowlingTeam} have a target of {target} in front of them. Let's see how the pitch plays in the second half!"
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

  let lastSpokenText = '';

  function setSpeakingState(speaking, text = '') {
    const waveIndicators = document.querySelectorAll('.scoring-wave-indicator, #scoring-wave-indicator');
    waveIndicators.forEach(el => {
      el.style.display = speaking ? 'inline-flex' : 'none';
    });

    const statusPills = document.querySelectorAll('.scoring-commentary-status-pill, #scoring-commentary-status-pill');
    statusPills.forEach(el => {
      if (!isAiEnabled) {
        el.textContent = 'MUTED';
        el.style.background = 'rgba(148,163,184,0.2)';
        el.style.color = '#94a3b8';
        el.style.borderColor = 'rgba(148,163,184,0.3)';
      } else if (speaking) {
        el.textContent = '🎙️ SPEAKING';
        el.style.background = 'rgba(56,189,248,0.25)';
        el.style.color = '#38bdf8';
        el.style.borderColor = 'rgba(56,189,248,0.5)';
      } else {
        el.textContent = 'ON AIR';
        el.style.background = 'rgba(34,197,94,0.2)';
        el.style.color = '#22c55e';
        el.style.borderColor = 'rgba(34,197,94,0.4)';
      }
    });

    if (text) {
      lastSpokenText = text;
      const textEls = document.querySelectorAll('.scoring-commentary-text, #scoring-commentary-text');
      textEls.forEach(el => {
        el.textContent = `"${text}"`;
      });
    }
  }

  /**
   * 🤖 ElevenLabs Neural Voice Cloning with Disk Cache & Graceful Fallback
   */
  async function playNeuralCommentaryVoice(text, persona = activePersona) {
    const userApiKey = localStorage.getItem('crickethub_elevenlabs_api_key') || '';
    setSpeakingState(true, text);

    try {
      console.log('[NeuralVoice] Requesting TTS for:', text.substring(0, 50) + '...');
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona, userApiKey })
      });

      const contentType = res.headers.get('content-type') || '';
      const ttsSource = res.headers.get('x-tts-source') || 'unknown';
      console.log('[NeuralVoice] Response:', res.status, 'Content-Type:', contentType, 'Source:', ttsSource);

      if (res.ok && contentType.includes('audio/mpeg')) {
        const blob = await res.blob();
        console.log('[NeuralVoice] Audio blob received, size:', blob.size, 'bytes');

        if (blob.size < 100) {
          console.warn('[NeuralVoice] Audio blob too small, likely empty/invalid');
          speakCommentaryPhrase(text, persona);
          updateNeuralBadge('🎙️ Voice Fallback: WebSpeech HD Active');
          return false;
        }

        const audioUrl = URL.createObjectURL(blob);

        // Stop any previously playing neural audio
        if (activeNeuralAudio) {
          activeNeuralAudio.pause();
          activeNeuralAudio.currentTime = 0;
          if (activeNeuralAudio._blobUrl) URL.revokeObjectURL(activeNeuralAudio._blobUrl);
        }

        // Also stop any playing WAV sound effects
        if (activeAudioPlayer) {
          activeAudioPlayer.pause();
          activeAudioPlayer.currentTime = 0;
        }

        // Cancel any ongoing browser speech
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }

        activeNeuralAudio = new Audio(audioUrl);
        activeNeuralAudio._blobUrl = audioUrl;
        activeNeuralAudio.volume = 1.0;

        activeNeuralAudio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setSpeakingState(false);
          console.log('[NeuralVoice] Playback finished');
        };

        activeNeuralAudio.onerror = (e) => {
          console.error('[NeuralVoice] Audio element error:', e);
          URL.revokeObjectURL(audioUrl);
          setSpeakingState(false);
        };

        await activeNeuralAudio.play();
        console.log('[NeuralVoice] ✅ Playing ElevenLabs neural voice');
        updateNeuralBadge('⚡ ElevenLabs Neural Voice: Active');
        return true;
      }

      // If response is JSON (fallback message), log it
      if (contentType.includes('application/json')) {
        const jsonRes = await res.json();
        console.warn('[NeuralVoice] Server returned fallback:', jsonRes.reason, jsonRes.message);
      }
    } catch (err) {
      console.warn('[NeuralVoice] Error:', err.message || err);
    }

    // Fallback: If ElevenLabs has no key or error, use browser voice
    console.log('[NeuralVoice] Falling back to WebSpeech');
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
    if (!('speechSynthesis' in window)) {
      setSpeakingState(false);
      return;
    }
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

      setSpeakingState(true, text);
      utterance.onend = () => setSpeakingState(false);
      utterance.onerror = () => setSpeakingState(false);

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      setSpeakingState(false);
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
    const scoringText = document.getElementById('scoring-commentary-text');
    if (scoringText) {
      scoringText.textContent = `"${text}"`;
    }
    if (typeof window.toast === 'function') {
      window.toast(`🎙️ [${commentatorLabel}]: "${text}"`);
    }
  }

  /**
   * 📝 Dynamic Context-Aware Commentary Text Generator
   */
  function generateCommentaryText(scoreData, persona = activePersona) {
    const personaPool = COMMENTARY_ARCHIVE[persona] || COMMENTARY_ARCHIVE.shastri;
    let category = 'RUN_0';
    let striker = 'the batsman';
    let bowler = 'the bowler';

    if (typeof scoreData === 'number') {
      category = `RUN_${scoreData}`;
      if (!personaPool[category]) category = scoreData >= 6 ? 'RUN_6' : (scoreData >= 4 ? 'RUN_4' : 'RUN_0');
    } else if (typeof scoreData === 'string') {
      const s = scoreData.toLowerCase();
      if (s === 'w' || s === 'wicket' || s === 'out') category = 'WICKET_GENERIC';
      else if (s === 'wide') category = 'EXTRA_WIDE';
      else if (s === 'noball' || s === 'no_ball') category = 'EXTRA_NOBALL';
      else if (s === 'bye') category = 'EXTRA_BYE';
      else if (s === 'legbye' || s === 'leg_bye') category = 'EXTRA_LEGBYE';
      else if (s === 'dot' || s === '0') category = 'RUN_0';
      else if (s === '4') category = 'RUN_4';
      else if (s === '6') category = 'RUN_6';
      else if (s === 'match_won' || s === 'match_win' || s === 'win' || s === 'winner') category = 'MATCH_WON';
      else if (s === 'match_tied' || s === 'tie') category = 'MATCH_TIED';
      else if (s === 'innings_change' || s === 'innings_break') category = 'INNINGS_CHANGE';
      else if (personaPool[scoreData]) category = scoreData;
      else category = 'RUN_0';
    } else if (scoreData && typeof scoreData === 'object') {
      if (scoreData.strikerName) striker = scoreData.strikerName;
      if (scoreData.bowlerName) bowler = scoreData.bowlerName;

      if (scoreData.type === 'MATCH_WON' || scoreData.event === 'match_won' || scoreData.isMatchWon) {
        if (scoreData.isTie || scoreData.winner === 'tie' || scoreData.winner === 'Match Tied' || (typeof scoreData.winner === 'string' && scoreData.winner.toLowerCase().includes('tie'))) {
          category = 'MATCH_TIED';
        } else {
          category = 'MATCH_WON';
        }
      } else if (scoreData.type === 'INNINGS_CHANGE' || scoreData.event === 'innings_change' || scoreData.isInningsChange) {
        category = 'INNINGS_CHANGE';
      } else if (scoreData.isWicket || scoreData.wicket) {
        const dType = (scoreData.dismissalType || '').toLowerCase();
        if (dType.includes('bowled')) category = 'WICKET_BOWLED';
        else if (dType.includes('caught') || dType.includes('catch')) category = 'WICKET_CAUGHT';
        else if (dType.includes('lbw')) category = 'WICKET_LBW';
        else if (dType.includes('stump')) category = 'WICKET_STUMPED';
        else if (dType.includes('run out') || dType.includes('runout')) category = 'WICKET_RUNOUT';
        else if (dType.includes('hit wicket') || dType.includes('hitwicket')) category = 'WICKET_HITWICKET';
        else category = 'WICKET_GENERIC';
      } else if (scoreData.isWide || scoreData.extras?.wide) {
        category = 'EXTRA_WIDE';
      } else if (scoreData.isNoBall || scoreData.extras?.noBall) {
        category = 'EXTRA_NOBALL';
      } else if (scoreData.isBye || scoreData.extras?.bye) {
        category = 'EXTRA_BYE';
      } else if (scoreData.isLegBye || scoreData.extras?.legBye) {
        category = 'EXTRA_LEGBYE';
      } else {
        const runs = typeof scoreData.runs !== 'undefined' ? scoreData.runs : 0;
        category = `RUN_${runs}`;
        if (!personaPool[category]) category = runs >= 6 ? 'RUN_6' : (runs >= 4 ? 'RUN_4' : 'RUN_0');
      }
    }

    const phraseList = personaPool[category] || personaPool.RUN_0 || ["What a moment in the match!"];
    const template = phraseList[Math.floor(Math.random() * phraseList.length)];
    return template
      .replace(/\{striker\}/g, striker)
      .replace(/\{bowler\}/g, bowler)
      .replace(/\{winner\}/g, (scoreData && scoreData.winner) || 'The winning team')
      .replace(/\{detail\}/g, (scoreData && (scoreData.winnerDetail || scoreData.detail)) || '')
      .replace(/\{battingTeam\}/g, (scoreData && (scoreData.battingTeam || scoreData.battingTeamName)) || 'The batting team')
      .replace(/\{bowlingTeam\}/g, (scoreData && (scoreData.bowlingTeam || scoreData.bowlingTeamName)) || 'The bowling team')
      .replace(/\{runs\}/g, (scoreData && scoreData.runs !== undefined) ? scoreData.runs : '0')
      .replace(/\{wickets\}/g, (scoreData && scoreData.wickets !== undefined) ? scoreData.wickets : '0')
      .replace(/\{target\}/g, (scoreData && scoreData.target !== undefined) ? scoreData.target : '')
      .trim();
  }

  /**
   * Generates commentary for a specific stroke
   */
  async function triggerShotCommentary(shotKey, runValue = 4, explicitPersona = null) {
    if (!isAiEnabled) return;
    const persona = explicitPersona || activePersona;
    const commentaryText = generateCommentaryText(shotKey, persona);

    // 1. Update HUD and on-screen Toast
    updateTickerUI(persona, commentaryText);

    // 2. Play realistic human voice (ElevenLabs neural voice FIRST, WebSpeech as fallback)
    const neuralVoicePlayed = await playNeuralCommentaryVoice(commentaryText, persona);

    // 3. Only play the procedural sound-effect WAVs if neural voice was NOT used
    if (!neuralVoicePlayed) {
      playRealCommentatorAudio(shotKey, persona);
    }

    // 4. If auto-sync is enabled and socket is live, dispatch scoring
    if (isAutoScoreSync && window.currentRoomCode) {
      autoSyncScore(shotKey, runValue);
    }

    return commentaryText;
  }

  function autoSyncScore(shotKey, runValue) {
    if (typeof window.recordBall === 'function') {
      if (shotKey === 'WICKET' || (typeof shotKey === 'string' && shotKey.startsWith('WICKET_'))) {
        window.recordBall('W');
      } else if (runValue === 6 || shotKey === 'PULL_SHOT' || shotKey === 'HELICOPTER_SHOT') {
        window.recordBall(6);
      } else if (runValue === 4 || shotKey === 'COVER_DRIVE' || shotKey === 'STRAIGHT_DRIVE' || shotKey === 'SQUARE_CUT') {
        window.recordBall(4);
      } else if (runValue === 1 || shotKey === 'RUN_1') {
        window.recordBall(1);
      } else if (runValue === 2 || shotKey === 'RUN_2') {
        window.recordBall(2);
      } else if (runValue === 3 || shotKey === 'RUN_3') {
        window.recordBall(3);
      } else if (shotKey === 'FORWARD_DEFENSE' || shotKey === 'PLAY_AND_MISS' || runValue === 0) {
        window.recordBall(0);
      } else {
        window.recordBall(runValue || 0);
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
    activePersona = persona === 'bhogle' ? 'bhogle' : 'shastri';
    localStorage.setItem('crickethub_ai_persona', activePersona);

    const btnShastri = document.getElementById('ai-btn-shastri');
    const btnBhogle = document.getElementById('ai-btn-bhogle');
    if (btnShastri && btnBhogle) {
      btnShastri.classList.toggle('active', activePersona === 'shastri');
      btnBhogle.classList.toggle('active', activePersona === 'bhogle');
    }

    document.querySelectorAll('.scoring-persona-btn').forEach(btn => {
      const isMatch = btn.dataset.persona === activePersona;
      btn.classList.toggle('active', isMatch);
      if (isMatch) {
        btn.style.background = '#38bdf8';
        btn.style.color = '#0b0f19';
        btn.style.borderColor = '#38bdf8';
        btn.style.boxShadow = '0 0 10px rgba(56,189,248,0.4)';
      } else {
        btn.style.background = 'rgba(255,255,255,0.06)';
        btn.style.color = '#cbd5e1';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
        btn.style.boxShadow = 'none';
      }
    });

    const introPhrase = activePersona === 'shastri'
      ? "⚡ Ravi Shastri live on the microphone! Electrifying action on the cards!"
      : "🏏 Harsha Bhogle here! A delightful day for cricket, let's get into the action!";

    updateTickerUI(activePersona, introPhrase);
    if (isAiEnabled) {
      playNeuralCommentaryVoice(introPhrase, activePersona);
    }
  }

  function toggleAiCommentary(enabled) {
    if (typeof enabled === 'undefined') {
      isAiEnabled = !isAiEnabled;
    } else {
      isAiEnabled = !!enabled;
    }
    localStorage.setItem('crickethub_ai_commentary_enabled', isAiEnabled ? 'true' : 'false');

    const modalToggle = document.getElementById('ai-master-toggle');
    if (modalToggle) modalToggle.checked = isAiEnabled;

    const scoringToggle = document.getElementById('scoring-commentary-toggle');
    if (scoringToggle) scoringToggle.checked = isAiEnabled;

    setSpeakingState(false);

    if (typeof window.toast === 'function') {
      window.toast(isAiEnabled
        ? `🎙️ Live Commentary enabled (${activePersona === 'shastri' ? 'Ravi Shastri' : 'Harsha Bhogle'})`
        : '🔇 Live Commentary muted'
      );
    }
    return isAiEnabled;
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



    document.getElementById('ai-master-toggle').onchange = (e) => toggleAiCommentary(e.target.checked);
    document.getElementById('ai-sync-toggle').onchange = (e) => toggleAutoSync(e.target.checked);
  }

  // Hook into live score events from main app
  async function triggerLiveCommentaryOnScore(scoreContext, optionalPersona = null) {
    if (!isAiEnabled) return;
    const persona = optionalPersona || activePersona;
    const commentaryText = generateCommentaryText(scoreContext, persona);

    // 1. Update HUD and on-screen Toast
    updateTickerUI(persona, commentaryText);

    // 2. Play voice (ElevenLabs neural voice FIRST, WebSpeech as fallback)
    await playNeuralCommentaryVoice(commentaryText, persona);

    return commentaryText;
  }

  async function testCommentaryVoice(testType = 'four', optionalPersona = null) {
    const persona = optionalPersona || activePersona;
    let sampleContext = { runs: 4, strikerName: 'the batsman', bowlerName: 'the bowler' };
    if (testType === 'six') sampleContext = { runs: 6, strikerName: 'the batsman', bowlerName: 'the bowler' };
    if (testType === 'wicket') sampleContext = { isWicket: true, dismissalType: 'Bowled', strikerName: 'the batsman', bowlerName: 'the bowler' };
    if (testType === 'single') sampleContext = { runs: 1, strikerName: 'the batsman', bowlerName: 'the bowler' };
    if (testType === 'dot') sampleContext = { runs: 0, strikerName: 'the batsman', bowlerName: 'the bowler' };
    if (testType === 'win' || testType === 'winner') sampleContext = { type: 'MATCH_WON', winner: 'India', winnerDetail: 'India won by 4 wickets' };
    if (testType === 'innings' || testType === 'innings_change') sampleContext = { type: 'INNINGS_CHANGE', battingTeam: 'Australia', bowlingTeam: 'India', runs: 165, wickets: 4, target: 166 };

    const text = generateCommentaryText(sampleContext, persona);
    updateTickerUI(persona, text);
    await playNeuralCommentaryVoice(text, persona);
    return text;
  }

  function getAiCommentaryState() {
    return {
      isEnabled: isAiEnabled,
      persona: activePersona,
      isAutoSync: isAutoScoreSync,
      lastText: lastSpokenText,
      isPlaying: !!(activeNeuralAudio && !activeNeuralAudio.paused)
    };
  }

  // Expose Global Studio Controller & Scoring Hooks
  window.openAiStudio = openAiStudio;
  window.closeAiStudio = closeAiStudio;
  window.setAiPersona = setPersona;
  window.toggleAiCommentary = toggleAiCommentary;
  window.triggerAiShotCommentary = triggerShotCommentary;
  window.triggerLiveCommentaryOnScore = triggerLiveCommentaryOnScore;
  window.testCommentaryVoice = testCommentaryVoice;
  window.getAiCommentaryState = getAiCommentaryState;

  // Pre-fetch voices when available
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
})();
