(function () {
  'use strict';

  /* ================= settings / balance ================= */
  var SAVE_KEY = 'cubefactory_save_v1';
  var SETTINGS_KEY = 'cubefactory_settings_v1';
  var START_CASH = 1000, FACTORY_PRICE = 800, MAX_LV = 30, MAX_FACTORY_LV = 90;
  var BASE_INTERVAL = 4, INTERVAL_DECAY = 0.94;      /* seconds per cube = 4 * 0.94^speed */
  var COST_BASE = { speed: 100, luck: 150, value: 120 }, COST_GROWTH = 1.45;
  var LUCK_STEP = 0.02;                               /* luck multiplier L = 1 + 0.02 * luckLevel */
  var VALUE_STEP = 0.10;                              /* sell value = base * (1 + 0.10 * valueLevel) */
  var TAP_BONUS = 1.25;                               /* tapping a cube on the belt sells it for +25% */

  /* order follows the cube files 01..09; base = weight (percent) before luck */
  var TIERS = [
    { key: 'common',    name: 'COMMON',    img: 'cube_01_white',  value: 1,     base: 60,   unlock: 0,  color: '#ffffff' },
    { key: 'uncommon',  name: 'UNCOMMON',  img: 'cube_02_green',  value: 3,     base: 25,   unlock: 0,  color: '#7ddc5a' },
    { key: 'rare',      name: 'RARE',      img: 'cube_03_cyan',   value: 10,    base: 10,   unlock: 0,  color: '#52d8ee' },
    { key: 'epic',      name: 'EPIC',      img: 'cube_04_blue',   value: 35,    base: 3.5,  unlock: 0,  color: '#5b8dff' },
    { key: 'legendary', name: 'LEGENDARY', img: 'cube_05_purple', value: 120,   base: 1,    unlock: 0,  color: '#b27bff' },
    { key: 'mythic',    name: 'MYTHIC',    img: 'cube_06_orange', value: 450,   base: 0.35, unlock: 0,  color: '#ffa033' },
    { key: 'divine',    name: 'DIVINE',    img: 'cube_07_red',    value: 2000,  base: 0.03, unlock: 20, color: '#ff5656' },
    { key: 'eternal',   name: 'ETERNAL',   img: 'cube_08_gold',   value: 8000,  base: 0.04, unlock: 50, color: '#ffd84a' },
    { key: 'ultimate',  name: 'ULTIMATE',  img: 'cube_09_rubik',  value: 50000, base: 0.01, unlock: 50, color: '#ff7ae6' }
  ];
  var TRACKS = [
    { key: 'speed', name: 'SPEED' },
    { key: 'luck',  name: 'LUCK' },
    { key: 'value', name: 'VALUE' }
  ];

  /* ================= scene geometry (scene units, 720 wide) ================= */
  var FACT_X = 53, FACT_S = 0.6;                       /* factory 1024 box scaled 0.6 */
  var HATCH_X = FACT_X + 512 * FACT_S;                 /* 360 */
  var BELT_Y = 628;                                    /* cube bottom-centre y while riding */
  var DROP_X = 588;                                    /* x where cube falls into collector */
  var CUBE_W = 148, CUBE_AX = 74, CUBE_AY = 136;       /* 512 * 0.29, anchor = bottom centre */
  var PRESS_TRAVEL = 140;

  /* ================= state ================= */
  var state = { cash: START_CASH, owned: false, speed: 0, luck: 0, value: 0 };
  var root, stage, scene, refs = {};
  var cubes = [], timers = [], floats = 0;
  var running = false, visible = false, acc = 0, last = 0, rafId = 0, dirty = false, saveT = 0;

  function $(id) { return document.getElementById(id); }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (typeof s.cash === 'number' && isFinite(s.cash) && s.cash >= 0) state.cash = s.cash;
        state.owned = s.owned === true;
        ['speed', 'luck', 'value'].forEach(function (k) {
          var v = parseInt(s[k], 10);
          state[k] = (v >= 0 && v <= MAX_LV) ? v : 0;
        });
      }
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
    dirty = false;
  }
  function markDirty() { dirty = true; }

  /* ================= formulas ================= */
  function factoryLevel() { return state.speed + state.luck + state.value; }
  function interval(lv) { return BASE_INTERVAL * Math.pow(INTERVAL_DECAY, lv === undefined ? state.speed : lv); }
  function beltSpeed() { return 150 + 6 * state.speed; }
  function luckMult(lv) { return 1 + LUCK_STEP * (lv === undefined ? state.luck : lv); }
  function valueMult(lv) { return 1 + VALUE_STEP * (lv === undefined ? state.value : lv); }
  function upgradeCost(key, lv) { return Math.round(COST_BASE[key] * Math.pow(COST_GROWTH, lv)); }
  function unlocked(t) { return factoryLevel() >= t.unlock; }
  function odds() {
    var L = luckMult(), w = [], sum = 0, i;
    for (i = 0; i < TIERS.length; i++) {
      var x = unlocked(TIERS[i]) ? TIERS[i].base * Math.pow(L, i) : 0;
      w.push(x); sum += x;
    }
    return w.map(function (x) { return x / sum; });
  }
  function rollTier() {
    var p = odds(), r = Math.random(), a = 0;
    for (var i = 0; i < p.length; i++) { a += p[i]; if (r < a) return i; }
    return 0;
  }

  function fmtMoney(n) {
    n = Math.floor(n);
    if (n < 10000) return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var u = ['K', 'M', 'B', 'T', 'Qa'], i = 0, v = n / 1000;
    var r = Number(v.toPrecision(3));
    while (r >= 1000 && i < u.length - 1) { r = Number((r / 1000).toPrecision(3)); i++; }
    return '$' + r + u[i];
  }
  function fmtPct(p) {
    var v = p * 100;
    return (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + '%';
  }
  function setting(key) {
    try { var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); return !s || s[key] !== false; } catch (e) { return true; }
  }
  function buzz(ms) { if (setting('vibration') && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  /* ================= DOM ================= */
  function build() {
    root = document.createElement('div');
    root.id = 'game';
    root.className = 'hidden';
    var A = 'assets/game/';
    root.innerHTML =
      '<div id="gbg"></div>' +
      '<div id="stage">' +
        '<div id="hud">' +
          '<button id="gBack" class="gbtn" type="button" aria-label="back"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f3e6c8" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4 7 12l8 8"/></svg></button>' +
          '<div id="cashBox"><img src="' + A + 'icon_cash_128x128.webp" alt=""><span id="cashText">$0</span></div>' +
          '<button id="gOdds" class="gbtn" type="button" aria-label="odds">%</button>' +
          '<div id="lvBadge">LV 0</div>' +
        '</div>' +
        '<div id="gscene">' +
          '<div id="gfactory" class="off">' +
            '<img src="' + A + 'factory_body_1024x1024.webp" style="left:0;top:0;width:1024px;height:1024px" alt="">' +
            '<img id="gearA" class="gear" src="' + A + 'factory_gear_a.webp" style="left:85px;top:380px;width:241px;height:241px" alt="">' +
            '<img id="gearB" class="gear rev" src="' + A + 'factory_gear_b.webp" style="left:699px;top:380px;width:241px;height:241px" alt="">' +
            '<img id="gpress" src="' + A + 'factory_press_512x512.webp" style="left:333px;top:190px;width:358px;height:358px" alt="">' +
            '<img id="gflap" src="' + A + 'factory_flap_512x256.webp" style="left:256px;top:724px;width:512px;height:256px" alt="">' +
            '<img class="lamp" src="' + A + 'factory_lamp_on_128x128.webp" style="left:86px;top:86px;width:128px;height:128px" alt="">' +
            '<img class="lamp" src="' + A + 'factory_lamp_on_128x128.webp" style="left:810px;top:86px;width:128px;height:128px" alt="">' +
          '</div>' +
          '<div id="gbelt" class="off"></div>' +
          '<div class="roller" style="left:102px;top:600px;background-position:0 0"></div>' +
          '<div class="roller" style="left:432px;top:600px;background-position:-96px 0"></div>' +
          '<div id="gcollector" class="off">' +
            '<img src="' + A + 'collector_body_512x512.webp" style="left:0;top:0;width:512px;height:512px" alt="">' +
            '<img id="glid" src="' + A + 'collector_lid_512x256.webp" style="left:0;top:10px;width:512px;height:256px" alt="">' +
          '</div>' +
          '<div id="gcubes"></div>' +
          '<div id="ghint">BUY THE FACTORY TO START</div>' +
        '</div>' +
        '<div id="gpanel"></div>' +
      '</div>' +
      '<div id="gflash"></div>' +
      '<div id="gOddsPanel" class="hidden"><div id="oddsBox"><h3>DROP CHANCES</h3><div id="oddsSub"></div><div id="oddsRows"></div><button id="oddsClose" type="button">CLOSE</button></div></div>';
    $('app').appendChild(root);

    stage = $('stage'); scene = $('gscene');
    refs.cash = $('cashText'); refs.lv = $('lvBadge'); refs.panel = $('gpanel');
    refs.factory = $('gfactory'); refs.belt = $('gbelt'); refs.collector = $('gcollector');
    refs.cubes = $('gcubes'); refs.hint = $('ghint'); refs.press = $('gpress'); refs.flap = $('gflap'); refs.lid = $('glid');
    refs.flash = $('gflash');

    $('gBack').addEventListener('click', hide);
    $('gOdds').addEventListener('click', openOdds);
    $('oddsClose').addEventListener('click', closeOdds);
    $('gOddsPanel').addEventListener('click', function (e) { if (e.target === $('gOddsPanel')) closeOdds(); });
    refs.panel.addEventListener('click', onPanelClick);
  }

  var ICONS = {
    speed: '<svg viewBox="0 0 24 24" fill="#ffd84a" stroke="#0a0d18" stroke-width="1.2" stroke-linejoin="round"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z"/></svg>',
    luck:  '<svg viewBox="0 0 24 24" fill="#7ddc5a" stroke="#0a0d18" stroke-width="1.2" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="4.2"/><circle cx="15.5" cy="8.5" r="4.2"/><circle cx="8.5" cy="15.5" r="4.2"/><circle cx="15.5" cy="15.5" r="4.2"/><path d="M12 12 12 22" stroke-width="1.8" fill="none"/></svg>',
    value: '<img src="assets/game/icon_cash_128x128.webp" alt="">'
  };

  function effectText(key) {
    var lv = state[key], nx = Math.min(MAX_LV, lv + 1);
    if (key === 'speed') return interval(lv).toFixed(2) + 's  >  ' + interval(nx).toFixed(2) + 's per cube';
    if (key === 'luck')  return 'rare chance x' + luckMult(lv).toFixed(3) + '  >  x' + luckMult(nx).toFixed(3);
    return 'sell value +' + Math.round(lv * VALUE_STEP * 100) + '%  >  +' + Math.round(nx * VALUE_STEP * 100) + '%';
  }

  function renderPanel() {
    var h = '';
    if (!state.owned) {
      h += '<button id="gBuy" class="gbig' + (state.cash < FACTORY_PRICE ? ' dis' : '') + '" type="button">BUY FACTORY &nbsp; ' + fmtMoney(FACTORY_PRICE) + '</button>';
      h += '<div class="gcap">Produces cubes of different rarities</div>';
    } else {
      TRACKS.forEach(function (t) {
        var lv = state[t.key], max = lv >= MAX_LV, cost = upgradeCost(t.key, lv);
        h += '<div class="urow" data-k="' + t.key + '">' +
          '<div class="uic">' + ICONS[t.key] + '</div>' +
          '<div class="utx"><div class="ut">' + t.name + '</div>' +
          '<div class="us">' + (max ? 'MAXED' : effectText(t.key)) + '</div>' +
          '<div class="ubar"><i style="width:' + (lv / MAX_LV * 100) + '%"></i></div>' +
          '<div class="ulv">LV ' + lv + ' / ' + MAX_LV + '</div></div>' +
          '<button class="ubuy' + (max ? ' max' : (state.cash < cost ? ' dis' : '')) + '" type="button" data-k="' + t.key + '">' + (max ? 'MAX' : fmtMoney(cost)) + '</button>' +
          '</div>';
      });
      h += '<div class="nextf">' + (factoryLevel() >= MAX_FACTORY_LV ? 'NEXT FACTORY - COMING SOON' : 'NEXT FACTORY - LOCKED (max all upgrades)') + '</div>';
    }
    refs.panel.innerHTML = h;
  }

  function renderHud() {
    refs.cash.textContent = fmtMoney(state.cash);
    refs.lv.textContent = state.owned ? ('LV ' + factoryLevel() + ' / ' + MAX_FACTORY_LV) : 'LOCKED';
  }

  function applyOwned() {
    var on = state.owned, off = !on;
    refs.factory.classList.toggle('off', off);
    refs.belt.classList.toggle('off', off);
    refs.collector.classList.toggle('off', off);
    refs.hint.style.display = on ? 'none' : 'block';
    var gd = Math.max(2, 8 - state.speed * 0.18) + 's';
    $('gearA').style.setProperty('--gdur', gd);
    $('gearB').style.setProperty('--gdur', gd);
    var bs = beltSpeed();
    refs.belt.style.setProperty('--bdur', (192 / bs).toFixed(3) + 's');
    var rd = (2.4 * 150 / bs).toFixed(3) + 's';
    var rs = document.querySelectorAll('#gscene .roller');
    for (var i = 0; i < rs.length; i++) rs[i].style.setProperty('--rdur', rd);
  }

  function refreshAll() {
    renderHud(); renderPanel(); applyOwned(); layout();
  }

  /* ================= layout ================= */
  function layout() {
    if (!stage) return;
    var s = window.innerWidth / 720;
    var H = window.innerHeight / s;
    stage.style.height = H + 'px';
    stage.style.transform = 'scale(' + s + ')';
    var panelH = refs.panel.offsetHeight || 220;
    refs.panel.style.bottom = '24px';
    refs.panel.style.top = 'auto';
    var avail = H - 140 - panelH - 40;
    var sc = Math.max(0.55, Math.min(1, avail / 830));
    var extra = Math.max(0, avail - 830 * sc);
    scene.style.transform = 'scale(' + sc.toFixed(4) + ')';
    scene.style.top = (140 + extra * 0.35) + 'px';
    if (scene.style.left === '') scene.style.left = '0px';
  }

  /* ================= production ================= */
  function schedule(delay, fn) { timers.push({ t: delay, fn: fn }); }

  function produce() {
    /* press down, hatch opens, cube comes out */
    refs.press.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + PRESS_TRAVEL + 'px)', offset: 0.45 }, { transform: 'translateY(0)' }], { duration: 420, easing: 'ease-in-out' });
    schedule(0.2, function () {
      refs.flap.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.18)', offset: 0.3 }, { transform: 'scaleY(.18)', offset: 0.7 }, { transform: 'scaleY(1)' }], { duration: 520, easing: 'ease-in-out' });
    });
    schedule(0.32, spawnCube);
  }

  function spawnCube() {
    if (!running || !state.owned) return;
    var ti = rollTier(), tier = TIERS[ti];
    var el = document.createElement('div');
    el.className = 'cube' + (ti >= 3 ? ' glow' : '') + (ti === 8 ? ' ult' : '');
    el.style.setProperty('--gc', tier.color);
    el.innerHTML = '<img src="assets/game/' + tier.img + '.webp" alt="">';
    refs.cubes.appendChild(el);
    var c = { el: el, tier: ti, value: Math.max(1, Math.round(tier.value * valueMult())), x: HATCH_X, y: 580, s: 0.6, o: 0, state: 'emerge', t: 0 };
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); tapCube(c); });
    cubes.push(c);
    place(c);
    if (ti >= 6) { refs.flash.classList.remove('go'); void refs.flash.offsetWidth; refs.flash.classList.add('go'); }
    if (ti >= 3) buzz(ti >= 6 ? 60 : 25);
  }

  function place(c) {
    c.el.style.opacity = c.o;
    c.el.style.transform = 'translate(' + (c.x - CUBE_AX).toFixed(1) + 'px,' + (c.y - CUBE_AY).toFixed(1) + 'px) scale(' + c.s.toFixed(3) + ')';
    c.el.style.transformOrigin = CUBE_AX + 'px ' + CUBE_AY + 'px';
  }

  function floatText(x, y, text, color, sub) {
    var d = document.createElement('div');
    d.className = 'ftxt';
    d.style.color = color;
    d.style.setProperty('--fx', (x - 130) + 'px');
    d.style.setProperty('--fy', y + 'px');
    d.innerHTML = (sub ? '<small>' + sub + '</small>' : '') + text;
    refs.cubes.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1200);
  }

  function addCash(n) {
    state.cash += n;
    refs.cash.textContent = fmtMoney(state.cash);
    refs.cash.classList.add('bump');
    setTimeout(function () { refs.cash.classList.remove('bump'); }, 120);
    markDirty();
  }

  function sell(c, bonus) {
    if (c.sold) return;
    c.sold = true;
    var tier = TIERS[c.tier];
    var amount = Math.round(c.value * (bonus || 1));
    addCash(amount);
    floatText(c.x, c.y - 130, '+' + fmtMoney(amount), tier.color, c.tier >= 3 ? tier.name : '');
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    var i = cubes.indexOf(c); if (i >= 0) cubes.splice(i, 1);
    refreshAffordability();
  }

  function tapCube(c) {
    if (c.state === 'drop' || c.sold) return;
    sell(c, TAP_BONUS);
    buzz(12);
  }

  function openLid() {
    refs.lid.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.2)', offset: 0.25 }, { transform: 'scaleY(.2)', offset: 0.7 }, { transform: 'scaleY(1)' }], { duration: 480, easing: 'ease-in-out' });
  }

  function updateCubes(dt) {
    var v = beltSpeed();
    for (var i = cubes.length - 1; i >= 0; i--) {
      var c = cubes[i];
      c.t += dt;
      if (c.state === 'emerge') {
        var k = Math.min(1, c.t / 0.3);
        var e = 1 - (1 - k) * (1 - k);
        c.y = 580 + (BELT_Y - 580) * e; c.s = 0.6 + 0.4 * e; c.o = Math.min(1, k * 2);
        if (k >= 1) { c.state = 'ride'; c.t = 0; }
      } else if (c.state === 'ride') {
        c.x += v * dt; c.y = BELT_Y; c.s = 1; c.o = 1;
        if (c.x >= DROP_X) { c.state = 'drop'; c.t = 0; openLid(); }
      } else if (c.state === 'drop') {
        var q = Math.min(1, c.t / 0.28);
        c.x = DROP_X; c.y = BELT_Y + 46 * q; c.s = 1 - 0.45 * q; c.o = 1 - q;
        if (q >= 1) { sell(c, 1); continue; }
      }
      place(c);
    }
  }

  /* ================= loop ================= */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!running) return;
    for (var i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { var f = timers[i].fn; timers.splice(i, 1); f(); }
    }
    if (state.owned) {
      acc += dt;
      var iv = interval();
      if (acc >= iv) { acc -= iv; if (acc > iv) acc = 0; produce(); }
    }
    updateCubes(dt);
    saveT += dt;
    if (saveT > 4) { saveT = 0; if (dirty) save(); }
  }

  /* ================= actions ================= */
  var lastAfford = '';
  function affordKey() {
    var k = state.owned ? '1' : '0';
    if (!state.owned) return k + (state.cash >= FACTORY_PRICE);
    TRACKS.forEach(function (t) { k += (state[t.key] >= MAX_LV ? 'm' : (state.cash >= upgradeCost(t.key, state[t.key]) ? 'y' : 'n')); });
    return k;
  }
  function refreshAffordability() {
    var k = affordKey();
    if (k !== lastAfford) { lastAfford = k; renderPanel(); layout(); }
  }

  function buyFactory() {
    if (state.owned) return;
    if (state.cash < FACTORY_PRICE) { shake($('gBuy')); return; }
    state.cash -= FACTORY_PRICE; state.owned = true; acc = BASE_INTERVAL - 0.8;
    save(); buzz(40);
    refs.flash.classList.remove('go'); void refs.flash.offsetWidth; refs.flash.classList.add('go');
    lastAfford = ''; refreshAll(); refreshAffordability();
  }

  function buyUpgrade(key) {
    var lv = state[key];
    if (lv >= MAX_LV) return;
    var cost = upgradeCost(key, lv);
    if (state.cash < cost) { shake(refs.panel.querySelector('.ubuy[data-k="' + key + '"]')); return; }
    state.cash -= cost; state[key] = lv + 1;
    save(); buzz(20);
    lastAfford = ''; refreshAll(); refreshAffordability();
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  function onPanelClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var b = t.closest('#gBuy'); if (b) { buyFactory(); return; }
    var u = t.closest('.ubuy'); if (u) buyUpgrade(u.getAttribute('data-k'));
  }

  function openOdds() {
    var p = odds(), h = '';
    $('oddsSub').textContent = 'Factory level ' + factoryLevel() + ' / ' + MAX_FACTORY_LV + '  -  Luck x' + luckMult().toFixed(3);
    TIERS.forEach(function (t, i) {
      var open = unlocked(t);
      h += '<div class="orow' + (open ? '' : ' lock') + '"><img src="assets/game/' + t.img + '.webp" alt="">' +
        '<span class="on" style="color:' + t.color + '">' + t.name + '</span>' +
        '<span class="op">' + (open ? fmtPct(p[i]) : 'UNLOCKS AT LV ' + t.unlock) + '</span></div>';
    });
    $('oddsRows').innerHTML = h;
    $('gOddsPanel').classList.remove('hidden');
  }
  function closeOdds() { $('gOddsPanel').classList.add('hidden'); }

  /* ================= show / hide ================= */
  function show() {
    if (!root) { build(); load(); }
    root.classList.remove('hidden');
    lastAfford = '';
    refreshAll(); refreshAffordability();
    layout();
    requestAnimationFrame(function () { root.classList.add('show'); });
    running = true; visible = true;
    last = performance.now();
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function hide() {
    closeOdds();
    running = false; visible = false;
    save();
    root.classList.remove('show');
    setTimeout(function () {
      if (!visible) {
        root.classList.add('hidden');
        refs.cubes.innerHTML = ''; cubes = []; timers = [];
      }
    }, 460);
    if (window.__menuBack) window.__menuBack();
  }

  window.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', function () { if (document.hidden && root) save(); });
  window.addEventListener('pagehide', function () { if (root) save(); });

  window.CubeGame = {
    show: show,
    hide: hide,
    _test: { state: state, odds: odds, tiers: TIERS, factoryLevel: factoryLevel, interval: interval, cost: upgradeCost, roll: rollTier }
  };
})();
