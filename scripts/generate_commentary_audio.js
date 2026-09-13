/**
 * Generates lightweight, crisp broadcast audio cue WAV files for CricketHub Commentary Soundboard
 */

const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio', 'commentary');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function createWavBuffer(sampleRate, durationSec, generateSample) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.max(-1, Math.min(1, generateSample(t, durationSec)));
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

const sampleRate = 22050;

// 1. Shastri Tracer Bullet Six (Booming Horn + Crowd Roar + Bat Crack)
const shastriSix = createWavBuffer(sampleRate, 2.8, (t, dur) => {
  const env = Math.exp(-t * 1.2) * (t < 0.1 ? t * 10 : 1);
  const crack = t < 0.08 ? (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.9 : 0;
  const bass = Math.sin(2 * Math.PI * 110 * t) * 0.3 * Math.exp(-t * 2);
  const crowd = (Math.random() * 2 - 1) * 0.15 * Math.sin((t / dur) * Math.PI);
  return (crack + bass + crowd) * env;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'shastri_six_tracer_bullet.wav'), shastriSix);

// 2. Shastri Boundary Four (Crisp Willow Crack + Whistle)
const shastriFour = createWavBuffer(sampleRate, 2.2, (t, dur) => {
  const env = Math.exp(-t * 1.5);
  const crack = t < 0.06 ? (Math.random() * 2 - 1) * Math.exp(-t * 80) : 0;
  const whistle = Math.sin(2 * Math.PI * (1200 + Math.sin(t * 30) * 200) * t) * 0.12 * Math.exp(-t * 3);
  const crowd = (Math.random() * 2 - 1) * 0.12 * Math.sin((t / dur) * Math.PI);
  return (crack + whistle + crowd) * env;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'shastri_four_covers.wav'), shastriFour);

// 3. Shastri Wicket Castled (Timber Stump Clatter + Shock Roar)
const shastriWicket = createWavBuffer(sampleRate, 2.5, (t, dur) => {
  const env = Math.exp(-t * 1.1);
  const wood1 = t < 0.05 ? Math.sin(2 * Math.PI * 450 * t) * Math.exp(-t * 50) : 0;
  const wood2 = (t > 0.04 && t < 0.12) ? Math.sin(2 * Math.PI * 620 * (t - 0.04)) * Math.exp(-(t - 0.04) * 40) : 0;
  const crowd = (Math.random() * 2 - 1) * 0.2 * Math.sin((t / dur) * Math.PI);
  return (wood1 + wood2 + crowd) * env;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'shastri_wicket_castled.wav'), shastriWicket);

// 4. Bhogle Symphony Four (Melodic Chime + Applause)
const bhogleFour = createWavBuffer(sampleRate, 2.4, (t, dur) => {
  const env = Math.exp(-t * 1.3);
  const batPing = t < 0.08 ? Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 40) : 0;
  const chime = Math.sin(2 * Math.PI * 523.25 * t) * 0.1 * Math.exp(-t * 2);
  const applause = (Math.random() * 2 - 1) * 0.14 * Math.sin((t / dur) * Math.PI);
  return (batPing + chime + applause) * env;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'bhogle_four_symphony.wav'), bhogleFour);

// 5. Bhogle Six Masterpiece
const bhogleSix = createWavBuffer(sampleRate, 2.9, (t, dur) => {
  const env = Math.exp(-t * 1.0);
  const batSmack = t < 0.07 ? (Math.random() * 2 - 1) * Math.exp(-t * 70) : 0;
  const crowd = (Math.random() * 2 - 1) * 0.22 * Math.sin((t / dur) * Math.PI);
  return (batSmack + crowd) * env;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'bhogle_six_masterpiece.wav'), bhogleSix);

// 6. Dot Ball / Forward Defense (Soft Willow Tap)
const dotDefense = createWavBuffer(sampleRate, 1.2, (t) => {
  const tap = t < 0.04 ? Math.sin(2 * Math.PI * 320 * t) * Math.exp(-t * 90) : 0;
  return tap * 0.6;
});
fs.writeFileSync(path.join(AUDIO_DIR, 'dot_ball_defense.wav'), dotDefense);

console.log('✅ Generated 6 Broadcast Audio Cues in "public/audio/commentary/"!');
