// ============================================================
// osu! Style Rhythm Game — Full Game Engine
// ============================================================

(() => {
  // ── Play.fun SDK Setup ──
  let pfSdk = null;
  let pfSdkReady = false;
  let paused = false;
  let safeTop = 0;
  let safeBottom = 0;
  const GAME_ID = '29760dc3-70fa-470b-bd92-203259f20747';

  if (typeof OpenGameSDK !== 'undefined') {
    pfSdk = new OpenGameSDK({
      ui: { usePointsWidget: true, theme: 'dark' },
      logLevel: 'info'
    });

    pfSdk.on('OnReady', () => {
      pfSdkReady = true;
      safeTop = parseInt(pfSdk.safeTopInset) || 0;
      safeBottom = parseInt(pfSdk.safeBottomInset) || 0;
      console.log('Play.fun SDK ready!');
    });

    pfSdk.on('SavePointsSuccess', () => console.log('Points saved to Play.fun!'));
    pfSdk.on('SavePointsFailed', () => console.log('Play.fun save failed'));
    pfSdk.on('GamePause', () => { paused = true; });
    pfSdk.on('GameResume', () => { paused = false; });

    pfSdk.init({ gameId: GAME_ID });
  }

  // ── Canvas Setup ──
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const cursorEl = document.getElementById('cursor');
  const menuEl = document.getElementById('menu');
  const resultsEl = document.getElementById('results');
  const songListEl = document.getElementById('songList');

  let W, H;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Custom Cursor ──
  let mouseX = W / 2, mouseY = H / 2;
  window.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursorEl.style.left = e.clientX + 'px';
    cursorEl.style.top = e.clientY + 'px';
  });

  // ── Constants ──
  const PLAYFIELD_PADDING = 80;
  const CIRCLE_RADIUS = 38;
  const APPROACH_RADIUS = CIRCLE_RADIUS * 3.2;
  const APPROACH_DURATION = 800; // ms for approach circle to shrink
  const HIT_WINDOW_PERFECT = 50;  // ms
  const HIT_WINDOW_GREAT = 100;
  const HIT_WINDOW_GOOD = 150;
  const HIT_WINDOW_MISS = 200;
  const SLIDER_FOLLOW_RADIUS = 60;
  const SPINNER_REQUIRED_ROTATIONS = 3;
  const HEALTH_DRAIN_RATE = 0.015;
  const FADE_OUT_DURATION = 300;

  // ── Colors ──
  const COLORS = [
    '#ff69b4', '#46b8ff', '#5eff7e', '#ffde5e',
    '#ff7e5e', '#b85eff', '#5effdf', '#ff5e98'
  ];

  // ── Audio Engine ──
  let audioCtx = null;
  let masterGain = null;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);
  }

  function playHitSound(type = 'normal') {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(masterGain);

    if (type === 'normal') {
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
      osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'slider') {
      osc.frequency.value = 600;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === 'spinner') {
      osc.frequency.value = 500;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.start(); osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === 'miss') {
      osc.frequency.value = 200;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
  }

  // Background music generator
  let bgMusicNodes = [];

  function startBackgroundMusic(bpm) {
    if (!audioCtx) return;
    stopBackgroundMusic();

    const beatInterval = 60 / bpm;

    // Kick drum pattern
    function scheduleKick(time) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      osc.start(time);
      osc.stop(time + 0.15);
      return { osc, gain };
    }

    // Hi-hat
    function scheduleHihat(time) {
      const bufferSize = audioCtx.sampleRate * 0.05;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 10000;
      const gain = audioCtx.createGain();
      source.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(masterGain);
      gain.gain.setValueAtTime(0.1, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      source.start(time);
      source.stop(time + 0.05);
      return { source, gain };
    }

    // Bass line
    function scheduleBass(time, note) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.frequency.value = note;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + beatInterval * 0.9);
      osc.start(time);
      osc.stop(time + beatInterval);
      return { osc, gain };
    }

    const bassNotes = [110, 110, 146.83, 130.81, 110, 110, 146.83, 130.81];
    let beatIndex = 0;
    const scheduleAhead = 0.1;
    let nextBeatTime = audioCtx.currentTime + 0.5;

    function scheduler() {
      while (nextBeatTime < audioCtx.currentTime + scheduleAhead + 1) {
        scheduleKick(nextBeatTime);
        scheduleHihat(nextBeatTime + beatInterval * 0.5);
        scheduleBass(nextBeatTime, bassNotes[beatIndex % bassNotes.length]);

        if (beatIndex % 4 === 2) {
          // Snare on beat 3
          const bufferSize = audioCtx.sampleRate * 0.1;
          const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          const gain = audioCtx.createGain();
          source.connect(gain);
          gain.connect(masterGain);
          gain.gain.setValueAtTime(0.2, nextBeatTime);
          gain.gain.exponentialRampToValueAtTime(0.001, nextBeatTime + 0.1);
          source.start(nextBeatTime);
          source.stop(nextBeatTime + 0.1);
        }

        nextBeatTime += beatInterval;
        beatIndex++;
      }

      bgMusicTimer = requestAnimationFrame(scheduler);
    }

    let bgMusicTimer = requestAnimationFrame(scheduler);
    bgMusicNodes.push({ stop: () => cancelAnimationFrame(bgMusicTimer) });
  }

  function stopBackgroundMusic() {
    bgMusicNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    bgMusicNodes = [];
  }

  // ── Game State ──
  let gameState = 'menu'; // menu, playing, results
  let currentBeatmap = null;
  let hitObjects = [];
  let activeHitObjects = [];
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let health = 100;
  let accuracy = { perfect: 0, great: 0, good: 0, miss: 0 };
  let startTime = 0;
  let hitEffects = [];
  let comboPopups = [];
  let mouseDown = false;
  let lastAngle = null;
  let totalSpinAngle = 0;
  let currentObjectIndex = 0;
  let backgroundParticles = [];

  // ── Hit Object Types ──
  const OBJ_CIRCLE = 0;
  const OBJ_SLIDER = 1;
  const OBJ_SPINNER = 2;

  // ── Beatmap Definitions ──
  const beatmaps = [
    {
      name: "Digital Sunrise",
      artist: "Synthwave Dreams",
      difficulty: "Easy",
      diffStars: 2,
      bpm: 120,
      color: '#46b8ff',
      generator: generateEasyMap
    },
    {
      name: "Neon Rush",
      artist: "Electric Pulse",
      difficulty: "Normal",
      diffStars: 3.5,
      bpm: 140,
      color: '#5eff7e',
      generator: generateNormalMap
    },
    {
      name: "Hyper Velocity",
      artist: "Chaos Engine",
      difficulty: "Hard",
      diffStars: 5,
      bpm: 170,
      color: '#ff69b4',
      generator: generateHardMap
    },
    {
      name: "Cosmic Shatter",
      artist: "Void Walker",
      difficulty: "Insane",
      diffStars: 7,
      bpm: 200,
      color: '#ff5e5e',
      generator: generateInsaneMap
    }
  ];

  // ── Beatmap Generators ──
  function randInPlayfield() {
    return {
      x: PLAYFIELD_PADDING + Math.random() * (W - PLAYFIELD_PADDING * 2),
      y: PLAYFIELD_PADDING + 60 + Math.random() * (H - PLAYFIELD_PADDING * 2 - 60)
    };
  }

  function clampToPlayfield(x, y) {
    return {
      x: Math.max(PLAYFIELD_PADDING, Math.min(W - PLAYFIELD_PADDING, x)),
      y: Math.max(PLAYFIELD_PADDING + 60, Math.min(H - PLAYFIELD_PADDING, y))
    };
  }

  function generateSliderPath(startX, startY, length) {
    const points = [{ x: startX, y: startY }];
    const angle = Math.random() * Math.PI * 2;
    const segments = 2 + Math.floor(Math.random() * 3);
    let cx = startX, cy = startY;

    for (let i = 0; i < segments; i++) {
      const a = angle + (Math.random() - 0.5) * Math.PI;
      const dist = length / segments;
      cx += Math.cos(a) * dist;
      cy += Math.sin(a) * dist;
      const clamped = clampToPlayfield(cx, cy);
      cx = clamped.x; cy = clamped.y;
      points.push({ x: cx, y: cy });
    }
    return points;
  }

  function generateEasyMap() {
    const objects = [];
    const beatInterval = 60000 / 120;
    let time = 2000;

    for (let i = 0; i < 40; i++) {
      const pos = randInPlayfield();
      if (i % 10 < 8) {
        objects.push({
          type: OBJ_CIRCLE, time, x: pos.x, y: pos.y,
          color: COLORS[i % COLORS.length], number: i + 1
        });
        time += beatInterval;
      } else if (i % 10 === 8) {
        const path = generateSliderPath(pos.x, pos.y, 200);
        objects.push({
          type: OBJ_SLIDER, time, x: pos.x, y: pos.y,
          path, duration: beatInterval * 2,
          color: COLORS[i % COLORS.length], number: i + 1
        });
        time += beatInterval * 3;
      } else {
        objects.push({
          type: OBJ_SPINNER, time,
          x: W / 2, y: H / 2,
          duration: 3000,
          color: '#ff69b4', number: i + 1
        });
        time += 4000;
      }
    }
    return objects;
  }

  function generateNormalMap() {
    const objects = [];
    const beatInterval = 60000 / 140;
    let time = 1500;

    for (let i = 0; i < 60; i++) {
      const pos = randInPlayfield();
      const roll = Math.random();

      if (roll < 0.65) {
        objects.push({
          type: OBJ_CIRCLE, time, x: pos.x, y: pos.y,
          color: COLORS[i % COLORS.length], number: i + 1
        });
        time += beatInterval;
      } else if (roll < 0.9) {
        const path = generateSliderPath(pos.x, pos.y, 250);
        objects.push({
          type: OBJ_SLIDER, time, x: pos.x, y: pos.y,
          path, duration: beatInterval * 1.5,
          color: COLORS[i % COLORS.length], number: i + 1
        });
        time += beatInterval * 2;
      } else {
        objects.push({
          type: OBJ_SPINNER, time,
          x: W / 2, y: H / 2,
          duration: 2500,
          color: '#ff69b4', number: i + 1
        });
        time += 3500;
      }
    }
    return objects;
  }

  function generateHardMap() {
    const objects = [];
    const beatInterval = 60000 / 170;
    let time = 1200;

    // Create patterns: streams, jumps, etc.
    for (let i = 0; i < 80; i++) {
      const pos = randInPlayfield();
      const roll = Math.random();

      if (roll < 0.5) {
        // Stream of 3-5 circles
        const streamLen = 3 + Math.floor(Math.random() * 3);
        const baseAngle = Math.random() * Math.PI * 2;
        let sx = pos.x, sy = pos.y;
        for (let j = 0; j < streamLen && i + j < 80; j++) {
          const clamped = clampToPlayfield(sx, sy);
          objects.push({
            type: OBJ_CIRCLE, time, x: clamped.x, y: clamped.y,
            color: COLORS[(i + j) % COLORS.length], number: objects.length + 1
          });
          sx += Math.cos(baseAngle) * 80;
          sy += Math.sin(baseAngle) * 80;
          time += beatInterval * 0.5;
        }
        i += streamLen - 1;
        time += beatInterval * 0.5;
      } else if (roll < 0.8) {
        const path = generateSliderPath(pos.x, pos.y, 300);
        objects.push({
          type: OBJ_SLIDER, time, x: pos.x, y: pos.y,
          path, duration: beatInterval * 1.2,
          color: COLORS[i % COLORS.length], number: objects.length + 1
        });
        time += beatInterval * 1.5;
      } else {
        objects.push({
          type: OBJ_SPINNER, time,
          x: W / 2, y: H / 2,
          duration: 2000,
          color: '#ff69b4', number: objects.length + 1
        });
        time += 2500;
      }
    }
    return objects;
  }

  function generateInsaneMap() {
    const objects = [];
    const beatInterval = 60000 / 200;
    let time = 1000;

    for (let i = 0; i < 120; i++) {
      const pos = randInPlayfield();
      const roll = Math.random();

      if (roll < 0.45) {
        // Fast stream
        const streamLen = 4 + Math.floor(Math.random() * 5);
        const baseAngle = Math.random() * Math.PI * 2;
        let sx = pos.x, sy = pos.y;
        for (let j = 0; j < streamLen && i + j < 120; j++) {
          const clamped = clampToPlayfield(sx, sy);
          objects.push({
            type: OBJ_CIRCLE, time, x: clamped.x, y: clamped.y,
            color: COLORS[(i + j) % COLORS.length], number: objects.length + 1
          });
          sx += Math.cos(baseAngle + j * 0.3) * 70;
          sy += Math.sin(baseAngle + j * 0.3) * 70;
          time += beatInterval * 0.35;
        }
        i += streamLen - 1;
        time += beatInterval * 0.3;
      } else if (roll < 0.7) {
        // Jump pattern
        for (let j = 0; j < 3; j++) {
          const jp = randInPlayfield();
          objects.push({
            type: OBJ_CIRCLE, time, x: jp.x, y: jp.y,
            color: COLORS[(i + j) % COLORS.length], number: objects.length + 1
          });
          time += beatInterval * 0.5;
        }
        i += 2;
      } else if (roll < 0.9) {
        const path = generateSliderPath(pos.x, pos.y, 350);
        objects.push({
          type: OBJ_SLIDER, time, x: pos.x, y: pos.y,
          path, duration: beatInterval,
          color: COLORS[i % COLORS.length], number: objects.length + 1
        });
        time += beatInterval * 1.2;
      } else {
        objects.push({
          type: OBJ_SPINNER, time,
          x: W / 2, y: H / 2,
          duration: 1800,
          color: '#ff69b4', number: objects.length + 1
        });
        time += 2200;
      }
    }
    return objects;
  }

  // ── Build Menu ──
  function buildMenu() {
    songListEl.innerHTML = '';
    beatmaps.forEach((map, index) => {
      const btn = document.createElement('button');
      btn.className = 'song-btn';
      btn.innerHTML = `
        <strong>${map.name}</strong> — ${map.artist}
        <div class="difficulty" style="color:${map.color}">
          ${'★'.repeat(Math.floor(map.diffStars))}${'☆'.repeat(7 - Math.floor(map.diffStars))}
          ${map.difficulty}
        </div>
        <span class="bpm">${map.bpm} BPM</span>
      `;
      btn.addEventListener('click', () => startGame(index));
      songListEl.appendChild(btn);
    });
  }

  // ── Start Game ──
  function startGame(mapIndex) {
    initAudio();
    currentBeatmap = beatmaps[mapIndex];
    hitObjects = currentBeatmap.generator();
    activeHitObjects = hitObjects.map(obj => ({
      ...obj,
      hit: false,
      missed: false,
      fadeOut: 0,
      sliderProgress: 0,
      sliderFollowing: false,
      spinnerAngle: 0,
      spinnerRotations: 0,
      spinnerComplete: false,
      active: false
    }));
    currentObjectIndex = 0;
    score = 0;
    combo = 0;
    maxCombo = 0;
    health = 100;
    accuracy = { perfect: 0, great: 0, good: 0, miss: 0 };
    hitEffects = [];
    comboPopups = [];
    backgroundParticles = [];
    gameState = 'playing';
    menuEl.style.display = 'none';
    resultsEl.style.display = 'none';
    startTime = performance.now() + 500;
    startBackgroundMusic(currentBeatmap.bpm);
  }

  // ── Input Handling ──
  window.addEventListener('mousedown', e => {
    mouseDown = true;
    cursorEl.classList.add('clicking');

    if (gameState === 'playing') {
      handleClick(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', () => {
    mouseDown = false;
    cursorEl.classList.remove('clicking');
    lastAngle = null;
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gameState === 'playing') {
      endGame();
    }
    // Z and X keys for clicking (like real osu!)
    if ((e.key === 'z' || e.key === 'x') && gameState === 'playing') {
      handleClick(mouseX, mouseY);
    }
  });

  function handleClick(clickX, clickY) {
    const elapsed = performance.now() - startTime;

    // Find the earliest unhit, unmissed object within hit window
    for (let i = 0; i < activeHitObjects.length; i++) {
      const obj = activeHitObjects[i];
      if (obj.hit || obj.missed) continue;

      const timeDiff = Math.abs(elapsed - obj.time);

      if (obj.type === OBJ_CIRCLE) {
        const dist = Math.hypot(clickX - obj.x, clickY - obj.y);
        if (dist <= CIRCLE_RADIUS + 10 && timeDiff <= HIT_WINDOW_MISS) {
          registerHit(obj, timeDiff, clickX, clickY);
          return;
        }
      } else if (obj.type === OBJ_SLIDER) {
        const dist = Math.hypot(clickX - obj.x, clickY - obj.y);
        if (dist <= CIRCLE_RADIUS + 10 && timeDiff <= HIT_WINDOW_MISS && !obj.sliderFollowing) {
          obj.sliderFollowing = true;
          obj.hit = true;
          playHitSound('slider');
          registerHit(obj, timeDiff, clickX, clickY);
          return;
        }
      } else if (obj.type === OBJ_SPINNER) {
        if (elapsed >= obj.time - HIT_WINDOW_MISS && elapsed <= obj.time + obj.duration) {
          obj.active = true;
          return;
        }
      }
    }
  }

  function registerHit(obj, timeDiff, x, y) {
    let hitType, points, color;

    if (timeDiff <= HIT_WINDOW_PERFECT) {
      hitType = 'PERFECT'; points = 300; color = '#46b8ff';
      accuracy.perfect++;
    } else if (timeDiff <= HIT_WINDOW_GREAT) {
      hitType = 'GREAT'; points = 100; color = '#5eff7e';
      accuracy.great++;
    } else if (timeDiff <= HIT_WINDOW_GOOD) {
      hitType = 'GOOD'; points = 50; color = '#ffde5e';
      accuracy.good++;
    } else {
      hitType = 'MEH'; points = 10; color = '#ff9e5e';
      accuracy.good++;
    }

    obj.hit = true;
    obj.fadeOut = performance.now();
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const earnedPoints = Math.floor(points * (1 + combo * 0.1));
    score += earnedPoints;
    health = Math.min(100, health + 3);

    // Send points to Play.fun
    if (pfSdk && pfSdkReady) pfSdk.addPoints(earnedPoints);

    playHitSound('normal');

    // Hit effect
    hitEffects.push({
      x: x || obj.x, y: y || obj.y,
      time: performance.now(),
      text: hitType,
      color,
      points
    });

    // Particles
    for (let i = 0; i < 8; i++) {
      backgroundParticles.push({
        x: obj.x, y: obj.y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 1,
        color: obj.color,
        size: 3 + Math.random() * 4
      });
    }
  }

  function registerMiss(obj) {
    obj.missed = true;
    obj.fadeOut = performance.now();
    accuracy.miss++;
    combo = 0;
    health = Math.max(0, health - 8);
    playHitSound('miss');

    hitEffects.push({
      x: obj.x, y: obj.y,
      time: performance.now(),
      text: 'MISS',
      color: '#ff5e5e',
      points: 0
    });

    if (health <= 0) {
      endGame();
    }
  }

  // ── End Game ──
  async function endGame() {
    gameState = 'results';
    stopBackgroundMusic();

    // Save points to Play.fun
    if (pfSdk && pfSdkReady && score > 0) {
      try {
        await pfSdk.endGame();
      } catch (e) {
        console.log('Play.fun save error:', e);
      }
    }

    const totalHits = accuracy.perfect + accuracy.great + accuracy.good + accuracy.miss;
    const acc = totalHits > 0
      ? ((accuracy.perfect * 300 + accuracy.great * 100 + accuracy.good * 50) / (totalHits * 300) * 100)
      : 0;

    let grade, gradeColor;
    if (acc >= 95) { grade = 'SS'; gradeColor = '#ffd700'; }
    else if (acc >= 90) { grade = 'S'; gradeColor = '#ffd700'; }
    else if (acc >= 80) { grade = 'A'; gradeColor = '#5eff7e'; }
    else if (acc >= 70) { grade = 'B'; gradeColor = '#46b8ff'; }
    else if (acc >= 60) { grade = 'C'; gradeColor = '#ffde5e'; }
    else { grade = 'D'; gradeColor = '#ff5e5e'; }

    document.getElementById('resultTitle').textContent = currentBeatmap.name;
    document.getElementById('resultTitle').style.color = currentBeatmap.color;
    document.getElementById('resultGrade').textContent = grade;
    document.getElementById('resultGrade').style.color = gradeColor;
    document.getElementById('resultScore').textContent = Math.floor(score).toLocaleString();
    document.getElementById('resultCombo').textContent = maxCombo + 'x';
    document.getElementById('resultAccuracy').textContent = acc.toFixed(2) + '%';
    document.getElementById('resultPerfect').textContent = accuracy.perfect;
    document.getElementById('resultGreat').textContent = accuracy.great;
    document.getElementById('resultGood').textContent = accuracy.good;
    document.getElementById('resultMiss').textContent = accuracy.miss;

    resultsEl.style.display = 'flex';
  }

  document.getElementById('retryBtn').addEventListener('click', () => {
    const idx = beatmaps.indexOf(currentBeatmap);
    startGame(idx);
  });

  document.getElementById('menuBtn').addEventListener('click', () => {
    resultsEl.style.display = 'none';
    menuEl.style.display = 'flex';
    gameState = 'menu';
  });

  // ── Slider Interpolation ──
  function getSliderPosition(path, t) {
    if (path.length < 2) return path[0];
    t = Math.max(0, Math.min(1, t));

    const totalLen = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      total += d;
      totalLen.push(total);
    }

    const targetDist = t * total;
    for (let i = 0; i < totalLen.length; i++) {
      const segStart = i === 0 ? 0 : totalLen[i - 1];
      if (targetDist <= totalLen[i]) {
        const segLen = totalLen[i] - segStart;
        const segT = segLen > 0 ? (targetDist - segStart) / segLen : 0;
        return {
          x: path[i].x + (path[i + 1].x - path[i].x) * segT,
          y: path[i].y + (path[i + 1].y - path[i].y) * segT
        };
      }
    }
    return path[path.length - 1];
  }

  // ── Render Functions ──
  function drawBackground(elapsed) {
    // Dark gradient background
    const gradient = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    gradient.addColorStop(0, '#1e1e3a');
    gradient.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // Animated background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 60;
    const offset = (elapsed * 0.02) % gridSize;
    for (let x = -gridSize + offset; x < W + gridSize; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = -gridSize + offset; y < H + gridSize; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawHitCircle(obj, elapsed) {
    const timeDiff = obj.time - elapsed;
    const now = performance.now();

    // Already hit — fade out
    if (obj.hit && obj.type === OBJ_CIRCLE) {
      const fadeProgress = (now - obj.fadeOut) / FADE_OUT_DURATION;
      if (fadeProgress >= 1) return;

      ctx.globalAlpha = 1 - fadeProgress;
      const scale = 1 + fadeProgress * 0.3;
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.scale(scale, scale);

      // Glow
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 20;

      ctx.beginPath();
      ctx.arc(0, 0, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      return;
    }

    if (obj.missed) {
      const fadeProgress = (now - obj.fadeOut) / FADE_OUT_DURATION;
      if (fadeProgress >= 1) return;
      ctx.globalAlpha = (1 - fadeProgress) * 0.5;

      ctx.beginPath();
      ctx.arc(obj.x, obj.y, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.globalAlpha = 1;
      return;
    }

    if (timeDiff > APPROACH_DURATION || timeDiff < -HIT_WINDOW_MISS) return;

    const approachProgress = 1 - Math.max(0, timeDiff) / APPROACH_DURATION;
    const alpha = Math.min(1, approachProgress * 2);
    ctx.globalAlpha = alpha;

    // Outer glow
    ctx.shadowColor = obj.color;
    ctx.shadowBlur = 15;

    // Hit circle body
    const bodyGrad = ctx.createRadialGradient(obj.x - 8, obj.y - 8, 0, obj.x, obj.y, CIRCLE_RADIUS);
    bodyGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
    bodyGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Hit circle border
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, CIRCLE_RADIUS * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = obj.color;
    ctx.fill();

    // Number
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(obj.number, obj.x, obj.y);

    // Approach circle
    if (timeDiff > 0) {
      const approachSize = CIRCLE_RADIUS + (APPROACH_RADIUS - CIRCLE_RADIUS) * (1 - approachProgress);
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, approachSize, 0, Math.PI * 2);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawSlider(obj, elapsed) {
    const timeDiff = obj.time - elapsed;
    const now = performance.now();

    if (obj.missed && !obj.hit) {
      const fadeProgress = (now - obj.fadeOut) / FADE_OUT_DURATION;
      if (fadeProgress >= 1) return;
      ctx.globalAlpha = (1 - fadeProgress) * 0.5;
      drawSliderBody(obj);
      ctx.globalAlpha = 1;
      return;
    }

    if (timeDiff > APPROACH_DURATION) return;

    const approachProgress = 1 - Math.max(0, timeDiff) / APPROACH_DURATION;
    const alpha = Math.min(1, approachProgress * 2);
    ctx.globalAlpha = alpha;

    // Draw slider body (path)
    drawSliderBody(obj);

    // Slider ball position during active sliding
    if (obj.hit && elapsed >= obj.time && elapsed <= obj.time + obj.duration) {
      const t = (elapsed - obj.time) / obj.duration;
      const pos = getSliderPosition(obj.path, t);

      // Check if cursor is following
      const dist = Math.hypot(mouseX - pos.x, mouseY - pos.y);
      if (dist > SLIDER_FOLLOW_RADIUS && mouseDown) {
        obj.sliderFollowing = false;
      }

      // Slider follow circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, SLIDER_FOLLOW_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = obj.sliderFollowing ? 'rgba(255,255,255,0.3)' : 'rgba(255,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Slider ball
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, CIRCLE_RADIUS * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = obj.color;
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (!obj.hit) {
      // Draw start circle (like a hit circle)
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 15;

      ctx.beginPath();
      ctx.arc(obj.x, obj.y, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 4;
      ctx.stroke();

      const bodyGrad = ctx.createRadialGradient(obj.x - 8, obj.y - 8, 0, obj.x, obj.y, CIRCLE_RADIUS);
      bodyGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
      bodyGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Number
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obj.number, obj.x, obj.y);

      // Approach circle
      if (timeDiff > 0) {
        const approachSize = CIRCLE_RADIUS + (APPROACH_RADIUS - CIRCLE_RADIUS) * (1 - approachProgress);
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, approachSize, 0, Math.PI * 2);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
    }

    // End slider
    if (obj.hit && elapsed > obj.time + obj.duration && !obj.sliderComplete) {
      obj.sliderComplete = true;
      if (obj.sliderFollowing) {
        score += 100 * (1 + combo * 0.1);
        health = Math.min(100, health + 2);
        playHitSound('slider');
      }
    }

    ctx.globalAlpha = 1;
  }

  function drawSliderBody(obj) {
    if (obj.path.length < 2) return;

    // Slider track
    ctx.beginPath();
    ctx.moveTo(obj.path[0].x, obj.path[0].y);
    for (let i = 1; i < obj.path.length; i++) {
      ctx.lineTo(obj.path[i].x, obj.path[i].y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = CIRCLE_RADIUS * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Slider border
    ctx.beginPath();
    ctx.moveTo(obj.path[0].x, obj.path[0].y);
    for (let i = 1; i < obj.path.length; i++) {
      ctx.lineTo(obj.path[i].x, obj.path[i].y);
    }
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = CIRCLE_RADIUS * 2 + 4;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // End circle
    const endPt = obj.path[obj.path.length - 1];
    ctx.beginPath();
    ctx.arc(endPt.x, endPt.y, CIRCLE_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawSpinner(obj, elapsed) {
    const timeDiff = obj.time - elapsed;
    const now = performance.now();

    if (obj.missed || (obj.spinnerComplete && now - obj.fadeOut > FADE_OUT_DURATION)) return;
    if (timeDiff > APPROACH_DURATION) return;

    const active = elapsed >= obj.time && elapsed <= obj.time + obj.duration;
    const alpha = Math.min(1, (1 - Math.max(0, timeDiff) / APPROACH_DURATION) * 2);
    ctx.globalAlpha = alpha;

    const cx = W / 2, cy = H / 2;
    const maxRadius = Math.min(W, H) * 0.3;

    // Handle spinning
    if (active && mouseDown) {
      const angle = Math.atan2(mouseY - cy, mouseX - cx);
      if (lastAngle !== null) {
        let delta = angle - lastAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        obj.spinnerAngle += delta;
        totalSpinAngle += Math.abs(delta);
        obj.spinnerRotations = Math.abs(obj.spinnerAngle) / (Math.PI * 2);

        if (Math.abs(delta) > 0.02) {
          playHitSound('spinner');
          score += Math.abs(delta) * 50;
        }
      }
      lastAngle = angle;
    } else if (active) {
      lastAngle = null;
    }

    // Completion check
    if (obj.spinnerRotations >= SPINNER_REQUIRED_ROTATIONS && !obj.spinnerComplete) {
      obj.spinnerComplete = true;
      obj.hit = true;
      obj.fadeOut = now;
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      score += 1000;
      health = Math.min(100, health + 5);
      accuracy.perfect++;
      if (pfSdk && pfSdkReady) pfSdk.addPoints(1000);

      hitEffects.push({
        x: cx, y: cy,
        time: now,
        text: 'CLEAR!',
        color: '#ffd700',
        points: 1000
      });
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctx.strokeStyle = active ? 'rgba(255,105,180,0.4)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Progress ring
    const progress = Math.min(1, obj.spinnerRotations / SPINNER_REQUIRED_ROTATIONS);
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = '#ff69b4';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#ff69b4';
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner spinner visual
    const innerRadius = 30;
    const rotation = obj.spinnerAngle || 0;
    for (let i = 0; i < 4; i++) {
      const a = rotation + (Math.PI / 2) * i;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * innerRadius, cy + Math.sin(a) * innerRadius);
      ctx.lineTo(cx + Math.cos(a) * (maxRadius * 0.6), cy + Math.sin(a) * (maxRadius * 0.6));
      ctx.strokeStyle = `rgba(255, 105, 180, ${0.3 + progress * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ff69b4';
    ctx.fill();

    // "SPIN!" text
    if (active && !obj.spinnerComplete) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SPIN!', cx, cy + maxRadius + 40);

      ctx.font = '18px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ff69b4';
      ctx.fillText(`${Math.floor(progress * 100)}%`, cx, cy + maxRadius + 65);
    }

    ctx.globalAlpha = 1;
  }

  function drawHUD(elapsed) {
    const margin = 16;
    const hudTop = safeTop + margin;

    // Score
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.floor(score).toLocaleString(), W - 20, hudTop + 24);

    // Combo
    if (combo > 0) {
      const comboSize = 40 + Math.min(combo, 20) * 0.5;
      ctx.font = `bold ${comboSize}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(combo + 'x', 20, H - safeBottom - margin - 10);
    }

    // Accuracy
    const totalHits = accuracy.perfect + accuracy.great + accuracy.good + accuracy.miss;
    const acc = totalHits > 0
      ? ((accuracy.perfect * 300 + accuracy.great * 100 + accuracy.good * 50) / (totalHits * 300) * 100)
      : 100;
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#aaa';
    ctx.fillText(acc.toFixed(2) + '%', W - 20, hudTop + 49);

    // Health bar
    const hbWidth = 300;
    const hbHeight = 10;
    const hbX = W / 2 - hbWidth / 2;
    const hbY = hudTop;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(hbX - 2, hbY - 2, hbWidth + 4, hbHeight + 4);

    const healthGrad = ctx.createLinearGradient(hbX, 0, hbX + hbWidth, 0);
    if (health > 50) {
      healthGrad.addColorStop(0, '#5eff7e');
      healthGrad.addColorStop(1, '#46b8ff');
    } else if (health > 25) {
      healthGrad.addColorStop(0, '#ffde5e');
      healthGrad.addColorStop(1, '#ff9e5e');
    } else {
      healthGrad.addColorStop(0, '#ff5e5e');
      healthGrad.addColorStop(1, '#ff2020');
    }

    ctx.fillStyle = healthGrad;
    ctx.fillRect(hbX, hbY, hbWidth * (health / 100), hbHeight);

    // Song progress bar
    if (hitObjects.length > 0) {
      const lastObj = hitObjects[hitObjects.length - 1];
      const totalDuration = lastObj.time + (lastObj.duration || 0) + 2000;
      const progress = Math.min(1, elapsed / totalDuration);

      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, H - 4, W, 4);
      ctx.fillStyle = currentBeatmap.color;
      ctx.fillRect(0, H - 4, W * progress, 4);
    }

    // Song name
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`${currentBeatmap.name} — ${currentBeatmap.artist} [${currentBeatmap.difficulty}]`, 15, hudTop + 10);
  }

  function drawHitEffects() {
    const now = performance.now();

    hitEffects = hitEffects.filter(e => {
      const age = now - e.time;
      if (age > 800) return false;

      const alpha = 1 - age / 800;
      const yOff = -age * 0.08;

      ctx.globalAlpha = alpha;
      ctx.font = `bold ${age < 100 ? 24 + (1 - age / 100) * 10 : 24}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 10;
      ctx.fillText(e.text, e.x, e.y + yOff);

      if (e.points > 0) {
        ctx.font = '16px "Segoe UI", sans-serif';
        ctx.fillText('+' + Math.floor(e.points), e.x, e.y + yOff + 25);
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return true;
    });
  }

  function drawParticles() {
    backgroundParticles = backgroundParticles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= 0.025;

      if (p.life <= 0) return false;

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });
  }

  // ── Main Game Loop ──
  function gameLoop() {
    requestAnimationFrame(gameLoop);

    if (gameState === 'menu') {
      drawMenuBackground();
      return;
    }

    if (gameState !== 'playing') return;
    if (paused) return; // Pause when Play.fun modal is open

    const elapsed = performance.now() - startTime;

    drawBackground(elapsed);

    // Health drain
    health = Math.max(0, health - HEALTH_DRAIN_RATE);

    // Check for missed objects
    for (const obj of activeHitObjects) {
      if (obj.hit || obj.missed) continue;

      if (obj.type === OBJ_CIRCLE) {
        if (elapsed > obj.time + HIT_WINDOW_MISS) {
          registerMiss(obj);
        }
      } else if (obj.type === OBJ_SLIDER) {
        if (elapsed > obj.time + HIT_WINDOW_MISS && !obj.hit) {
          registerMiss(obj);
        }
      } else if (obj.type === OBJ_SPINNER) {
        if (elapsed > obj.time + obj.duration && !obj.spinnerComplete) {
          registerMiss(obj);
        }
      }
    }

    // Draw objects (in reverse so earliest is on top)
    for (let i = activeHitObjects.length - 1; i >= 0; i--) {
      const obj = activeHitObjects[i];
      if (obj.type === OBJ_SLIDER) drawSlider(obj, elapsed);
    }
    for (let i = activeHitObjects.length - 1; i >= 0; i--) {
      const obj = activeHitObjects[i];
      if (obj.type === OBJ_CIRCLE) drawHitCircle(obj, elapsed);
    }
    for (let i = activeHitObjects.length - 1; i >= 0; i--) {
      const obj = activeHitObjects[i];
      if (obj.type === OBJ_SPINNER) drawSpinner(obj, elapsed);
    }

    drawParticles();
    drawHitEffects();
    drawHUD(elapsed);

    // Check if map is complete
    const allDone = activeHitObjects.every(o => o.hit || o.missed);
    if (allDone && activeHitObjects.length > 0) {
      setTimeout(() => {
        if (gameState === 'playing') endGame();
      }, 1500);
    }

    if (health <= 0) {
      endGame();
    }
  }

  // ── Menu Background ──
  let menuParticles = [];
  for (let i = 0; i < 50; i++) {
    menuParticles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: 1 + Math.random() * 2,
      alpha: 0.1 + Math.random() * 0.3
    });
  }

  function drawMenuBackground() {
    const gradient = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    gradient.addColorStop(0, '#1e1e3a');
    gradient.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // Floating particles
    menuParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#ff69b4';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Pulsing ring
    const pulse = Math.sin(performance.now() / 600) * 0.3 + 0.7;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 - 50, 150 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 105, 180, ${0.05 * pulse})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Init ──
  buildMenu();
  gameLoop();
})();
