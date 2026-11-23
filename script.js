(() => {
  'use strict';

  /* =====================================================
     PENGATURAN
     ===================================================== */
  const DURASI = 60;         // detik per sesi menjawab (1 menit per tim)
  const MAX_STRIKE = 1;      // salah berapa kali sebelum giliran pindah
  const POIN_DEFAULT = 1;    // dipakai jika "poin" sebuah jawaban masih null

  /* =====================================================
     DATA SOAL
     poin: null -> kotak poin dikosongkan
     ===================================================== */
  const SOAL = [
    {
      babak: 'BABAK PRELIMINARY',
      sesi: 'FACE OFF 10',
      tanya: 'Sebutkan 5 makanan yang namanya tidak sesuai dengan bahan atau bentuk aslinya!',
      jawaban: [
        { teks: 'Telur mata sapi', poin: 30 },
        { teks: 'Kue cubit',       poin: 25 },
        { teks: 'Roti buaya',      poin: 20 },
        { teks: 'Kaki naga',       poin: 15 },
        { teks: 'Lidah kucing',    poin: 10 }
      ]
    },
    {
      babak: 'BABAK PRELIMINARY',
      sesi: 'FACE OFF 10',
      tanya: 'Name 5 countries in the world that have a coastline',
      jawaban: [
        { teks: 'Brazil',    poin: 30 },
        { teks: 'Indonesia', poin: 25 },
        { teks: 'Australia', poin: 20 },
        { teks: 'Canada',    poin: 15 },
        { teks: 'Japan',     poin: 10 }
      ]
    },
    {
      babak: 'BABAK PRELIMINARY',
      sesi: 'FACE OFF 10',
      tanya: 'Sebutkan 5 hewan yang namanya diulang dalam bahasa Indonesia.',
      jawaban: [
        { teks: 'Kupu-kupu',     poin: 20 },
        { teks: 'Kura-kura',     poin: 20 },
        { teks: 'Laba-laba',     poin: 20 },
        { teks: 'Ubur-ubur',     poin: 20 },
        { teks: 'Kunang-kunang', poin: 20 }
      ]
    }
  ];

  /* =====================================================
     STATE
     ===================================================== */
  const $ = id => document.getElementById(id);
  const S = {
    q: 0,
    names: ['Tim A', 'Tim B'],
    scores: [0, 0],
    strikes: [0, 0],
    active: 0,
    phase: 'setup',   // setup | pick | play | steal | done
    time: DURASI,
    running: false,
    locked: false,    // true saat jeda otomatis (setelah salah / waktu habis)
    open: []
  };
  let lastTs = 0;
  let lastSec = DURASI;
  let toastTimer = null;

  /* =====================================================
     SUARA (WebAudio, tanpa file)
     ===================================================== */
  let ctx = null;
  let muted = false;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const sfx = {
    ding()    { tone(880, 0.25, 'triangle', 0.25); tone(1320, 0.55, 'triangle', 0.25, 0.12); },
    buzz()    { tone(110, 0.7, 'sawtooth', 0.28); tone(95, 0.7, 'square', 0.14); },
    tick()    { tone(1000, 0.06, 'square', 0.07); },
    fanfare() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.25, i * 0.14)); }
  };

  /* =====================================================
     UTIL
     ===================================================== */
  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function flashX(n) {
    const el = $('strikeFlash');
    el.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.textContent = '✕';
      el.appendChild(s);
    }
    el.classList.remove('show');
    void el.offsetWidth; // restart animasi
    el.classList.add('show');
  }

  /* =====================================================
     RENDER
     ===================================================== */
  function renderScores(popTeam = -1) {
    for (let t = 0; t < 2; t++) {
      const box = $('team' + t);
      box.querySelector('.tname').textContent = S.names[t];
      const sc = box.querySelector('.tscore');
      sc.textContent = S.scores[t];
      if (t === popTeam) {
        sc.classList.remove('pop');
        void sc.offsetWidth;
        sc.classList.add('pop');
      }
    }
  }

  function renderStrikes() {
    for (let t = 0; t < 2; t++) {
      $('team' + t).querySelectorAll('.strikes i').forEach((el, i) => {
        el.style.display = i < MAX_STRIKE ? '' : 'none';
        el.classList.toggle('on', i < S.strikes[t]);
      });
    }
  }

  function renderActive() {
    const playing = S.phase === 'play' || S.phase === 'steal';
    for (let t = 0; t < 2; t++) {
      $('team' + t).classList.toggle('active', playing && S.active === t);
    }
    const lab = $('phaseLabel');
    lab.classList.toggle('steal', S.phase === 'steal');
    if (S.phase === 'play') lab.textContent = `${S.names[S.active]} menjawab`;
    else if (S.phase === 'steal') lab.textContent = `Kesempatan curi: ${S.names[S.active]}`;
    else if (S.phase === 'done') lab.textContent = 'Soal selesai';
    else lab.textContent = '';
  }

  function renderTimer() {
    const t = $('timer');
    t.textContent = fmtTime(S.time);
    t.classList.toggle('warn', S.running && S.time <= 10);
    const fill = $('barFill');
    fill.style.width = (Math.max(0, S.time) / DURASI * 100) + '%';
    fill.classList.toggle('warn', S.time <= 10);
  }

  function renderControls() {
    const playing = (S.phase === 'play' || S.phase === 'steal');
    const live = playing && S.running;
    $('board').classList.toggle('live', live);
    $('btnWrong').disabled = !live;
    $('btnPause').disabled = !playing || S.locked;
    $('btnPause').textContent = S.running ? '⏸ JEDA' : '▶ LANJUT';
    $('btnReveal').disabled = !playing;
    $('btnNext').hidden = S.phase !== 'done';
    $('btnNext').textContent = S.q >= SOAL.length - 1 ? 'LIHAT HASIL AKHIR ▶' : 'SOAL BERIKUTNYA ▶';
  }

  function renderBoard() {
    const q = SOAL[S.q];
    const board = $('board');
    board.innerHTML = '';
    q.jawaban.forEach((a, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = i;
      slot.innerHTML =
        '<div class="num"></div>' +
        '<div class="card"><div class="face front"></div>' +
        '<div class="face back"><span class="ans"></span></div></div>' +
        '<div class="pts"></div>';
      slot.querySelector('.num').textContent = i + 1;
      slot.querySelector('.card').addEventListener('click', () => manualReveal(i));
      board.appendChild(slot);
    });
  }

  function renderAll() {
    renderScores();
    renderStrikes();
    renderActive();
    renderTimer();
    renderControls();
  }

  /* =====================================================
     ALUR GAME
     ===================================================== */
  function startGame() {
    S.names = [
      $('nameA').value.trim() || 'Tim A',
      $('nameB').value.trim() || 'Tim B'
    ];
    S.scores = [0, 0];
    S.q = 0;
    $('setup').classList.remove('show');
    $('endCard').classList.remove('show');
    $('game').hidden = false;
    audio(); // aktifkan audio setelah interaksi pertama
    loadQuestion(0);
  }

  function loadQuestion(i) {
    S.q = i;
    const q = SOAL[i];
    S.open = q.jawaban.map(() => false);
    S.strikes = [0, 0];
    S.phase = 'pick';
    S.running = false;
    S.locked = false;
    S.time = DURASI;
    lastSec = DURASI;

    $('roundTitle').textContent = q.babak;
    $('roundSub').textContent = `${q.sesi}  •  SOAL ${i + 1}/${SOAL.length}`;
    $('question').textContent = q.tanya;
    renderBoard();
    renderAll();

    $('pickRound').textContent = `Soal ${i + 1} dari ${SOAL.length}`;
    $('pickNameA').value = S.names[0];
    $('pickNameB').value = S.names[1];
    $('pickA').textContent = S.names[0];
    $('pickB').textContent = S.names[1];
    $('resetWrap').hidden = (i === 0);
    $('resetScore').checked = (i > 0);
    $('pick').classList.add('show');
  }

  function startPhase(team, phase) {
    S.active = team;
    S.phase = phase;
    S.time = DURASI;
    S.running = true;
    S.locked = false;
    lastTs = performance.now();
    lastSec = DURASI;
    renderAll();
  }

  function pickTeam(team) {
    S.names = [
      $('pickNameA').value.trim() || 'Tim A',
      $('pickNameB').value.trim() || 'Tim B'
    ];
    if (S.q > 0 && $('resetScore').checked) S.scores = [0, 0];
    $('pick').classList.remove('show');
    audio();
    startPhase(team, 'play');
  }

  function switchToSteal(reason) {
    const other = 1 - S.active;
    S.strikes[other] = 0;
    toast(`${reason} Giliran ${S.names[other]} untuk merebut poin!`, 2800);
    startPhase(other, 'steal');
  }

  function afterLoss(reason) {
    // dipanggil setelah salah (sampai batas) atau waktu habis
    S.running = false;
    S.locked = true;
    renderControls();
    setTimeout(() => {
      if (S.phase === 'play') switchToSteal(reason);
      else if (S.phase === 'steal') endQuestion();
    }, 1300);
  }

  function timeUp() {
    S.running = false;
    S.time = 0;
    renderTimer();
    sfx.buzz();
    toast('⏰ Waktu habis!', 1500);
    afterLoss('Waktu habis!');
  }

  function wrong() {
    if (!S.running) return;
    S.strikes[S.active]++;
    flashX(S.strikes[S.active]);
    sfx.buzz();
    renderStrikes();
    if (S.strikes[S.active] >= MAX_STRIKE) afterLoss('Jawaban salah!');
  }

  function reveal(i, team, award = true) {
    if (S.open[i]) return;
    S.open[i] = true;
    const a = SOAL[S.q].jawaban[i];
    const slot = $('board').children[i];
    slot.querySelector('.ans').textContent = a.teks.toUpperCase();
    slot.querySelector('.pts').textContent = (a.poin == null) ? '' : a.poin;
    slot.classList.add('open');
    if (!award) {
      slot.classList.add('missed');
      return;
    }
    S.scores[team] += (typeof a.poin === 'number') ? a.poin : POIN_DEFAULT;
    sfx.ding();
    renderScores(team);
    if (S.open.every(Boolean)) {
      S.running = false;
      S.locked = true;
      renderControls();
      setTimeout(() => endQuestion(), 900);
    }
  }

  // Jawaban peserta dibuktikan benar -> klik kotaknya
  function manualReveal(i) {
    if (!S.running || S.open[i]) return;
    reveal(i, S.active, true);
  }

  function endQuestion() {
    if (S.phase === 'done') return;
    S.running = false;
    S.locked = false;
    S.phase = 'done';
    SOAL[S.q].jawaban.forEach((_, i) => {
      if (!S.open[i]) setTimeout(() => reveal(i, -1, false), i * 220);
    });
    renderAll();
  }

  function nextQuestion() {
    if (S.q >= SOAL.length - 1) showEnd();
    else loadQuestion(S.q + 1);
  }

  function showEnd() {
    $('fNameA').textContent = S.names[0];
    $('fNameB').textContent = S.names[1];
    $('fScoreA').textContent = S.scores[0];
    $('fScoreB').textContent = S.scores[1];
    const [a, b] = S.scores;
    $('winner').textContent = a === b ? 'SERI!' : `${S.names[a > b ? 0 : 1]} MENANG!`;
    $('endCard').classList.add('show');
    sfx.fanfare();
  }

  function togglePause() {
    if (S.locked || !(S.phase === 'play' || S.phase === 'steal')) return;
    S.running = !S.running;
    lastTs = performance.now();
    renderControls();
    renderTimer();
  }

  /* =====================================================
     TIMER LOOP
     ===================================================== */
  function onTick() {
    const now = performance.now();
    if (!S.running) { lastTs = now; return; }
    S.time -= (now - lastTs) / 1000;
    lastTs = now;

    const sec = Math.ceil(S.time);
    if (sec !== lastSec) {
      lastSec = sec;
      if (sec <= 10 && sec > 0) sfx.tick();
    }
    if (S.time <= 0) { timeUp(); return; }
    renderTimer();
  }

  /* =====================================================
     EVENT
     ===================================================== */
  $('btnStart').addEventListener('click', startGame);
  ['nameA', 'nameB'].forEach(id =>
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); })
  );
  $('pickA').addEventListener('click', () => pickTeam(0));
  $('pickB').addEventListener('click', () => pickTeam(1));
  $('pickNameA').addEventListener('input', e => { $('pickA').textContent = e.target.value.trim() || 'Tim A'; });
  $('pickNameB').addEventListener('input', e => { $('pickB').textContent = e.target.value.trim() || 'Tim B'; });

  $('btnWrong').addEventListener('click', wrong);
  $('btnPause').addEventListener('click', togglePause);
  $('btnReveal').addEventListener('click', endQuestion);
  $('btnNext').addEventListener('click', nextQuestion);
  $('btnRestart').addEventListener('click', () => {
    $('endCard').classList.remove('show');
    $('game').hidden = true;
    $('setup').classList.add('show');
    S.phase = 'setup';
    S.running = false;
  });

  document.querySelectorAll('.adj button').forEach(b => {
    b.addEventListener('click', () => {
      const t = +b.dataset.t, d = +b.dataset.d;
      S.scores[t] = Math.max(0, S.scores[t] + d);
      renderScores(d > 0 ? t : -1);
    });
  });

  $('btnMute').addEventListener('click', () => {
    muted = !muted;
    $('btnMute').textContent = muted ? '🔇' : '🔊';
  });
  $('btnFull').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Pintasan keyboard: 1-9 = buka jawaban, X = salah
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'x' || e.key === 'X') { wrong(); return; }
    if (/^[1-9]$/.test(e.key)) manualReveal(+e.key - 1);
  });

  setInterval(onTick, 200);
})();