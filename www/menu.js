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

  /* ---- video background drawn onto canvas (cover) ---- */
  var vid = $('vid'), cv = $('bg'), ctx = cv.getContext('2d');
  function resize() {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(window.innerWidth * d));
    cv.height = Math.max(1, Math.round(window.innerHeight * d));
  }
  window.addEventListener('resize', resize);
  resize();
  function frame() {
    try {
      if (vid.readyState >= 2 && vid.videoWidth > 0) {
        var vw = vid.videoWidth, vh = vid.videoHeight;
        var sc = Math.max(cv.width / vw, cv.height / vh);
        var w = vw * sc, h = vh * sc;
        ctx.drawImage(vid, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
      }
    } catch (e) {}
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  function tryPlay() { try { var p = vid.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  vid.muted = true;
  tryPlay();
  vid.addEventListener('canplay', tryPlay);
  document.addEventListener('touchstart', tryPlay, { passive: true });
  document.addEventListener('click', tryPlay);

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
      });
    })(tgs[i]);
  }
  function openSettings() { $('settings').classList.remove('hidden'); buzz(); }
  function closeSettings() { $('settings').classList.add('hidden'); buzz(); }
  $('btnSettings').addEventListener('click', openSettings);
  $('btnClose').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', function (e) { if (e.target === $('settings')) closeSettings(); });

  /* ---- play ---- */
  $('btnPlay').addEventListener('click', function () { buzz(); toast('Coming soon...'); });

  renderToggles();
  window.__menuReady = true;
})();
