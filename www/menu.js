(function () {
  'use strict';
  var KEY = 'cubefactory_settings_v1';
  var ON = 'assets/ui/toggle_on_400x200.png';
  var OFF = 'assets/ui/toggle_off_400x200.png';
  var settings = { music: true, sound: true, vibration: true };

  function $(id) { return document.getElementById(id); }

  try {
    var s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) { for (var k in settings) { if (typeof s[k] === 'boolean') settings[k] = s[k]; } }
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }

  /* ---- audio ---- */
  var musicEl = new Audio('assets/audio/cube_factory_theme.wav');
  musicEl.loop = true; musicEl.volume = 0.6; musicEl.preload = 'auto';
  var doorsEl = new Audio('assets/audio/play_doors_open.wav');
  var clickEl = new Audio('assets/audio/ui_click.wav');
  function startMusic() {
    if (!settings.music) return;
    try { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function playSfx(a) {
    if (!settings.sound) return;
    try { var c = a.cloneNode(); var p = c.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  var musicUnlocked = false;
  function unlockAudio() {
    if (musicUnlocked) return;
    musicUnlocked = true;
    startMusic();
  }
  /* Android needs a touch before audio can start: the first tap starts the menu music */
  document.addEventListener('touchstart', unlockAudio, { passive: true });
  document.addEventListener('click', unlockAudio);

  /* ---- video background: draw each NEW video frame onto canvas (cover) ---- */
  var vid = $('vid'), cv = $('bg'), ctx = cv.getContext('2d');
  var lastT = -1, shown = false;
  /* intro starts when the background shows (or after 1.5s at most, so the menu never stays hidden) */
  setTimeout(function () { document.body.classList.add('go'); }, 1500);

  function resize() {
    /* DPR capped at 1: the background is soft anyway, and this saves a lot of GPU/CPU */
    cv.width = Math.max(1, Math.round(window.innerWidth));
    cv.height = Math.max(1, Math.round(window.innerHeight));
    lastT = -1;
  }
  window.addEventListener('resize', resize);
  resize();

  function drawIfNew() {
    if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.currentTime !== lastT) {
      lastT = vid.currentTime;
      var vw = vid.videoWidth, vh = vid.videoHeight;
      var sc = Math.max(cv.width / vw, cv.height / vh);
      var w = vw * sc, h = vh * sc;
      try { ctx.drawImage(vid, (cv.width - w) / 2, (cv.height - h) / 2, w, h); } catch (e) {}
      if (!shown) { shown = true; cv.classList.add('ready'); document.body.classList.add('go'); }
    }
  }
  function loop() { drawIfNew(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  function tryPlay() { try { var p = vid.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  vid.muted = true;
  tryPlay();
  vid.addEventListener('loadeddata', tryPlay);
  vid.addEventListener('canplay', tryPlay);
  document.addEventListener('touchstart', tryPlay, { passive: true, once: true });

  /* ---- helpers ---- */
  function buzz() {
    if (settings.vibration && navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1600);
  }

  /* ---- settings ---- */
  function renderToggles() {
    var tgs = document.querySelectorAll('.tg');
    for (var i = 0; i < tgs.length; i++) {
      var key = tgs[i].getAttribute('data-key');
      tgs[i].querySelector('img').src = settings[key] ? ON : OFF;
    }
  }
  var tgs = document.querySelectorAll('.tg');
  for (var i = 0; i < tgs.length; i++) {
    (function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-key');
        settings[key] = !settings[key];
        save(); renderToggles(); buzz();
        if (key === 'music') { if (settings.music) { startMusic(); } else { musicEl.pause(); } }
      });
    })(tgs[i]);
  }
  function openSettings() { $('settings').classList.remove('hidden'); buzz(); }
  function closeSettings() { $('settings').classList.add('hidden'); buzz(); }
  $('btnSettings').addEventListener('click', openSettings);
  $('btnClose').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', function (e) { if (e.target === $('settings')) closeSettings(); });

  /* ---- play ---- */
  function leaveMenuMusic() {
    var v = musicEl.volume, steps = 0;
    var iv = setInterval(function () {
      steps++;
      musicEl.volume = Math.max(0, v * (1 - steps / 12));
      if (steps >= 12) { clearInterval(iv); musicEl.pause(); musicEl.volume = v; }
    }, 50);
  }
  $('btnPlay').addEventListener('click', function () {
    buzz();
    playSfx(doorsEl);
    leaveMenuMusic();
    toast('Coming soon...');
  });

  /* ---- click sound for any other tap (PLAY has its own sound) ---- */
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#btnPlay')) return;
    playSfx(clickEl);
  });

  renderToggles();
  window.__menuReady = true;
})();
