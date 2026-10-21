(function () {
  'use strict';

  /* ================= settings / balance ================= */
  var SAVE_KEY = 'cubefactory_save_v2';
  var SETTINGS_KEY = 'cubefactory_settings_v1';
  var START_CASH = 1000, FACTORY_PRICE = 800, BREAKER_PRICE = 15000;
  var MAX_LV = 50, MAX_FACTORY_LV = 150;
  var BASE_INTERVAL = 10, INTERVAL_DECAY = 0.98;     /* seconds per cube = 10 * 0.98^speed */
  var COST_BASE = { speed: 100, luck: 150, value: 120 }, COST_GROWTH = 1.30;
  var LUCK_STEP = 0.05;                               /* luck multiplier L = 1 + 0.05 * luckLevel */
  var VALUE_STEP = 0.10;                              /* sell value = base * (1 + 0.10 * valueLevel) */
  var MAX_WAIT = 3;                                   /* cubes waiting on the belt before the factory stops */
  var AUTO_TIME = 1.0;                                /* seconds per cube for the automatic breaker */

  /* weight = relative chance (white 100, each next tier half), hits = taps needed to break */
  var TIERS = [
    { key: 'common',    name: 'COMMON',    img: 'cube_01_white',  value: 1,     w: 100,   hits: 2,  unlock: 0,  color: '#ffffff' },
    { key: 'uncommon',  name: 'UNCOMMON',  img: 'cube_02_green',  value: 3,     w: 50,    hits: 3,  unlock: 0,  color: '#7ddc5a' },
    { key: 'rare',      name: 'RARE',      img: 'cube_03_cyan',   value: 10,    w: 25,    hits: 4,  unlock: 0,  color: '#52d8ee' },
    { key: 'epic',      name: 'EPIC',      img: 'cube_04_blue',   value: 35,    w: 12.5,  hits: 5,  unlock: 0,  color: '#5b8dff' },
    { key: 'legendary', name: 'LEGENDARY', img: 'cube_05_purple', value: 120,   w: 6.25,  hits: 6,  unlock: 0,  color: '#b27bff' },
    { key: 'mythic',    name: 'MYTHIC',    img: 'cube_06_orange', value: 450,   w: 3.125, hits: 8,  unlock: 0,  color: '#ffa033' },
    { key: 'divine',    name: 'DIVINE',    img: 'cube_07_red',    value: 2000,  w: 0.06,  hits: 10, unlock: 20, color: '#ff5656' },
    { key: 'eternal',   name: 'ETERNAL',   img: 'cube_08_gold',   value: 8000,  w: 0.08,  hits: 12, unlock: 50, color: '#ffd84a' },
    { key: 'ultimate',  name: 'ULTIMATE',  img: 'cube_09_rubik',  value: 50000, w: 0.02,  hits: 15, unlock: 50, color: '#ff7ae6' }
  ];
  var TRACKS = [
    { key: 'speed', name: 'SPEED' },
    { key: 'luck',  name: 'LUCK' },
    { key: 'value', name: 'VALUE' }
  ];
  var PLOTS = [
    { key: 'back',  price: 50000,  x0: -7, x1: 22, z0: -12.6, z1: -4.6 },
    { key: 'front', price: 120000, x0: -7, x1: 22, z0: 2.8,   z1: 10.8 }
  ];
  var MAIN = { x0: -7, x1: 22, z0: -4.6, z1: 2.8 };

  /* ================= camera model (from the art manifest) ================= */
  var U = 72;                                         /* design px per world unit */
  var K = U / 373.68;                                 /* cube file px -> design px */
  var PXU = U * 0.945, ZXc = -U * 0.326, YYc = U * 0.875, ZYc = U * 0.485;
  var BELT_Y = 1.28;                                  /* height of the belt surface (world units) */
  var YS = -BELT_Y * YYc;                             /* screen y of the belt surface */
  function P(x, y, z) { return { x: x * PXU + z * ZXc, y: -y * YYc + z * ZYc }; }

  var HATCH_X = 0.0, PAD_A = 2.9, SPACE = 1.3, VX_BASE = 150 / PXU;
  var XB = 13.0;                                      /* breaker centre (world x) */
  var BIN_A = 6.4, BIN_B = 19.6;                      /* bin centre before / after the breaker is owned */
  var FAC_X = -1.25;                                  /* factory centre so its hatch sits at x = 0 */
  var G3 = 'assets/g3/';
  var CUBE_SCALE = 1.3;                               /* cubes are drawn a bit bigger so they are easy to tap */

  /* ================= state ================= */
  var state = { cash: START_CASH, owned: false, speed: 0, luck: 0, value: 0, breaker: false, back: false, front: false };
  var root, stage, scene, world, refs = {}, L = {};
  var cubes = [], piles = [], parts = [], timers = [], pending = 0;
  var running = false, visible = false, acc = 0, last = 0, rafId = 0, dirty = false, saveT = 0;
  var cam = { x: 0, y: 0, s: 0.82 }, view = { w: 720, h: 1280 }, camSet = false, panned = false;
  var autoT = 0, hammerBusy = false, lastAfford = '', moving = false;
  var tintCache = {}, imgCache = {};

  function $(id) { return document.getElementById(id); }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (typeof s.cash === 'number' && isFinite(s.cash) && s.cash >= 0) state.cash = s.cash;
        state.owned = s.owned === true;
        state.breaker = s.breaker === true;
        state.back = s.back === true;
        state.front = s.front === true;
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
  function beltPx() { return 150 + 6 * state.speed; }          /* belt speed in design px per second */
  function luckMult(lv) { return 1 + LUCK_STEP * (lv === undefined ? state.luck : lv); }
  function valueMult(lv) { return 1 + VALUE_STEP * (lv === undefined ? state.value : lv); }
  function upgradeCost(key, lv) { return Math.round(COST_BASE[key] * Math.pow(COST_GROWTH, lv)); }
  function unlocked(t) { return factoryLevel() >= t.unlock; }
  function odds() {
    var Lm = luckMult(), w = [], sum = 0, i;
    for (i = 0; i < TIERS.length; i++) {
      var x = unlocked(TIERS[i]) ? TIERS[i].w * Math.pow(Lm, i) : 0;
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

  /* ================= layout of the world ================= */
  function padX() { return state.breaker ? XB : PAD_A; }
  function binX() { return state.breaker ? BIN_B : BIN_A; }
  function beltEndPx() { return P(binX(), 0, 0).x - 78; }
  function beltStartPx() { return P(HATCH_X + 0.35, 0, 0).x; }
  function worldBounds() {
    return { left: -300, right: state.breaker ? 1480 : 1130 };
  }

  /* ================= sprite helper ================= */
  function spr(parent, path, w, h, scale, ax, ay, pt, cls) {
    var im = new Image();
    im.src = G3 + path;
    im.className = 'sp' + (cls ? ' ' + cls : '');
    im.draggable = false;
    im.style.left = (pt.x - ax * scale) + 'px';
    im.style.top = (pt.y - ay * scale) + 'px';
    im.style.width = (w * scale) + 'px';
    im.style.height = (h * scale) + 'px';
    parent.appendChild(im);
    return im;
  }
  function div(parent, id, cls) {
    var d = document.createElement('div');
    if (id) d.id = id;
    if (cls) d.className = cls;
    parent.appendChild(d);
    return d;
  }

  /* ================= build the scene ================= */
  var ICONS = {
    speed: '<svg viewBox="0 0 24 24" fill="#ffd84a" stroke="#0a0d18" stroke-width="1.2" stroke-linejoin="round"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z"/></svg>',
    luck:  '<svg viewBox="0 0 24 24" fill="#7ddc5a" stroke="#0a0d18" stroke-width="1.2" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="4.2"/><circle cx="15.5" cy="8.5" r="4.2"/><circle cx="8.5" cy="15.5" r="4.2"/><circle cx="15.5" cy="15.5" r="4.2"/><path d="M12 12 12 22" stroke-width="1.8" fill="none"/></svg>',
    value: '<img src="assets/game/icon_cash_128x128.webp" alt="">'
  };

  function buildFloor(svgParent) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    svg.setAttribute('class', 'floor');
    svg.style.overflow = 'visible';
    function pts(r) {
      return [P(r.x0, 0, r.z0), P(r.x1, 0, r.z0), P(r.x1, 0, r.z1), P(r.x0, 0, r.z1)]
        .map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    }
    function grid(r, col) {
      var h = '', x, z, a, b;
      for (x = r.x0; x <= r.x1 + 0.01; x += 2) {
        a = P(x, 0, r.z0); b = P(x, 0, r.z1);
        h += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + col + '" stroke-width="2"/>';
      }
      for (z = r.z0; z <= r.z1 + 0.01; z += 2) {
        a = P(r.x0, 0, z); b = P(r.x1, 0, z);
        h += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + col + '" stroke-width="2"/>';
      }
      return h;
    }
    function fence(r) {
      var c = [P(r.x0, 0, r.z0), P(r.x1, 0, r.z0), P(r.x1, 0, r.z1), P(r.x0, 0, r.z1)];
      var d = 'M' + c.map(function (p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L') + ' Z';
      return '<path d="' + d + '" fill="none" stroke="#5a0f0d" stroke-width="11" stroke-linejoin="round"/>' +
             '<path d="' + d + '" fill="none" stroke="#e5352f" stroke-width="6" stroke-linejoin="round" stroke-dasharray="46 14"/>';
    }
    var h = '<polygon points="' + pts(MAIN) + '" fill="#2f7d4b"/>' + grid(MAIN, 'rgba(255,255,255,.10)') +
            '<polygon points="' + pts(MAIN) + '" fill="none" stroke="#9be3b0" stroke-width="4"/>';
    PLOTS.forEach(function (r) {
      if (state[r.key]) {
        h += '<polygon points="' + pts(r) + '" fill="#2f7d4b"/>' + grid(r, 'rgba(255,255,255,.10)') +
             '<polygon points="' + pts(r) + '" fill="none" stroke="#9be3b0" stroke-width="4"/>';
      } else {
        h += '<polygon points="' + pts(r) + '" fill="#6b7080"/>' + grid(r, 'rgba(0,0,0,.14)') + fence(r);
      }
    });
    svg.innerHTML = h;
    svgParent.appendChild(svg);
    return svg;
  }

  function buildPlotLabels() {
    L.plots.innerHTML = '';
    PLOTS.forEach(function (r) {
      if (state[r.key]) return;
      var c = P((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      var d = div(L.plots, null, 'plotTag');
      d.setAttribute('data-plot', r.key);
      d.style.left = c.x + 'px'; d.style.top = c.y + 'px';
      d.innerHTML = '<svg viewBox="0 0 60 70" width="70" height="82"><path d="M30 66 6 34h15V4h18v30h15z" fill="#ffb21f" stroke="#0a0d18" stroke-width="4" stroke-linejoin="round"/></svg><b>' + fmtMoney(r.price) + '</b>';
    });
  }

  function build() {
    root = document.createElement('div');
    root.id = 'game';
    root.className = 'hidden';
    root.innerHTML =
      '<div id="gbg"></div>' +
      '<div id="stage">' +
        '<div id="gscene"><div id="gworld"></div></div>' +
        '<div id="ghintTop">BUY THE FACTORY TO START</div>' +
        '<div id="gswipe"><svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4l8 8-8 8"/></svg><span>SWIPE</span></div>' +
        '<div id="hud">' +
          '<button id="gBack" class="gbtn" type="button" aria-label="back"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f3e6c8" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4 7 12l8 8"/></svg></button>' +
          '<div id="cashBox"><img src="assets/game/icon_cash_128x128.webp" alt=""><span id="cashText">$0</span></div>' +
          '<button id="gOdds" class="gbtn" type="button" aria-label="odds">%</button>' +
          '<div id="lvBadge">LV 0</div>' +
        '</div>' +
        '<div id="gpanel"></div>' +
      '</div>' +
      '<div id="gflash"></div>' +
      '<div id="gOddsPanel" class="hidden"><div id="oddsBox"><h3>DROP CHANCES</h3><div id="oddsSub"></div><div id="oddsRows"></div><button id="oddsClose" type="button">CLOSE</button></div></div>';
    $('app').appendChild(root);

    stage = $('stage'); scene = $('gscene'); world = $('gworld');
    refs.cash = $('cashText'); refs.lv = $('lvBadge'); refs.panel = $('gpanel');
    refs.hint = $('ghintTop'); refs.swipe = $('gswipe'); refs.flash = $('gflash');

    /* layers, back to front */
    L.floor = div(world, null, 'lay');
    buildFloor(L.floor);
    L.factory = div(world, 'lFactory', 'lay');
    L.legs = div(world, null, 'lay');
    L.belt = div(world, null, 'lay');
    L.cubes = div(world, null, 'lay');
    L.breaker = div(world, 'lBreaker', 'lay');
    L.binBack = div(world, 'lBinBack', 'lay');
    L.piles = div(world, null, 'lay');
    L.binFront = div(world, 'lBinFront', 'lay');
    L.fx = div(world, null, 'lay');
    L.plots = div(world, null, 'lay');
    L.labels = div(world, null, 'lay');

    buildFactory();
    buildBelt();
    buildBreaker();
    buildBin();
    buildPlotLabels();

    $('gBack').addEventListener('click', hide);
    $('gOdds').addEventListener('click', openOdds);
    $('oddsClose').addEventListener('click', closeOdds);
    $('gOddsPanel').addEventListener('click', function (e) { if (e.target === $('gOddsPanel')) closeOdds(); });
    refs.panel.addEventListener('click', onPanelClick);
    bindPointer();
  }

  /* ---- factory: all anchors come from the manifest (body pixel space) ---- */
  function buildFactory() {
    var F = P(FAC_X, 0, -2), fs = 2.201 * K;
    function fp(px, py) { return { x: F.x + (px - 512) * fs, y: F.y + (py - 855) * fs }; }
    refs.fs = fs; refs.fp = fp;
    var g = L.factory;
    spr(g, 'factory/factory_body.webp', 1024, 1024, fs, 512, 855, F);
    refs.gearA = spr(g, 'factory/factory_gear_a.webp', 256, 256, 2.179 * K, 128, 128, fp(149, 661), 'gear');
    refs.gearB = spr(g, 'factory/factory_gear_b.webp', 256, 256, 2.179 * K, 128, 128, fp(295, 774), 'gear rev');
    refs.lampsOn = [
      spr(g, 'factory/factory_lamp_on.webp', 128, 128, 2.097 * K, 64, 95, fp(115, 414), 'lamp'),
      spr(g, 'factory/factory_lamp_on.webp', 128, 128, 2.097 * K, 64, 95, fp(756, 414), 'lamp')
    ];
    refs.lampsOff = [
      spr(g, 'factory/factory_lamp_off.webp', 128, 128, 2.097 * K, 64, 95, fp(115, 414), 'lampoff'),
      spr(g, 'factory/factory_lamp_off.webp', 128, 128, 2.097 * K, 64, 95, fp(756, 414), 'lampoff')
    ];
    refs.press = spr(g, 'factory/factory_press.webp', 512, 512, 2.214 * K, 256, 341, fp(512, 243));
    refs.pressTravel = (288 - 243) * fs;
    var ds = 2.336 * K;
    refs.door = spr(g, 'factory/factory_hatch_door.webp', 384, 256, ds, 192, 16, fp(596, 604));
    refs.door.style.transformOrigin = (192 * ds) + 'px ' + (16 * ds) + 'px';
    refs.fbox = { x: F.x, y: F.y - 200 };
    refs.full = div(L.labels, null, 'fullTag');
    refs.full.textContent = 'FULL - BREAK THE CUBES';
    refs.full.style.left = F.x + 'px';
    refs.full.style.top = (F.y - 470) + 'px';
  }

  /* ---- belt, legs, break pad ---- */
  function buildBelt() {
    L.legs.innerHTML = ''; L.belt.innerHTML = '';
    var sb = 2.373 * K, x0 = beltStartPx(), x1 = beltEndPx();
    var n, x;
    for (x = x0 + 40; x < x1 - 20; x += 190) {
      spr(L.legs, 'belt/belt_leg.webp', 128, 192, 2.898 * K, 64, 140, { x: x, y: 0 });
    }
    refs.beltDiv = div(L.belt, null, 'beltTile');
    refs.beltDiv.style.left = x0 + 'px';
    refs.beltDiv.style.top = (-242 * sb) + 'px';
    refs.beltDiv.style.width = (x1 - x0) + 'px';
    refs.beltDiv.style.height = (192 * sb) + 'px';
    refs.beltDiv.style.backgroundImage = 'url(' + G3 + 'belt/belt_tile.webp)';
    refs.beltDiv.style.backgroundSize = (256 * sb) + 'px ' + (192 * sb) + 'px';
    refs.beltDiv.style.setProperty('--per', (256 * sb) + 'px');
    refs.beltPeriod = 256 * sb;
    spr(L.belt, 'belt/belt_cap_left.webp', 192, 192, 4.286 * K, 133, 100, { x: x0, y: YS });
    spr(L.belt, 'belt/belt_cap_right.webp', 192, 192, 4.286 * K, 59, 100, { x: x1, y: YS });
    refs.pad = spr(L.belt, 'belt/break_pad.webp', 256, 192, 2.251 * K, 128, 96, { x: P(padX(), 0, 0).x, y: YS }, 'pad');
  }

  /* ---- breaker machine (locked cover until bought) ---- */
  function buildBreaker() {
    L.breaker.innerHTML = '';
    var B = P(XB, 0, 0), bs = 2.124 * K;
    function bp(px, py) { return { x: B.x + (px - 512) * bs, y: B.y + (py - 854) * bs }; }
    refs.bp = bp; refs.bs = bs;
    var g = L.breaker;
    refs.bCover = spr(g, 'breaker/breaker_locked_cover.webp', 1024, 1024, bs, 512, 854, B);
    refs.bGroup = div(g, null, 'bgroup');
    var q = refs.bGroup;
    spr(q, 'breaker/breaker_body.webp', 1024, 1024, bs, 512, 854, B);
    refs.bGearL = spr(q, 'breaker/breaker_gear.webp', 256, 256, 2.050 * K, 128, 128, bp(166, 489), 'gear');
    refs.bGearR = spr(q, 'breaker/breaker_gear.webp', 256, 256, 2.050 * K, 128, 128, bp(605, 489), 'gear rev');
    refs.bLampOn = [
      spr(q, 'breaker/breaker_lamp_on.webp', 128, 128, 2.097 * K, 64, 95, bp(171, 276), 'lamp'),
      spr(q, 'breaker/breaker_lamp_on.webp', 128, 128, 2.097 * K, 64, 95, bp(687, 276), 'lamp')
    ];
    refs.bLampOff = [
      spr(q, 'breaker/breaker_lamp_off.webp', 128, 128, 2.097 * K, 64, 95, bp(171, 276), 'lampoff'),
      spr(q, 'breaker/breaker_lamp_off.webp', 128, 128, 2.097 * K, 64, 95, bp(687, 276), 'lampoff')
    ];
    refs.hammer = spr(q, 'breaker/breaker_hammer.webp', 512, 512, 1.721 * K, 254, 396, bp(512, 451));
    refs.hammerTravel = (500 - 451) * bs;
    refs.bTag = div(L.labels, null, 'bTag');
    refs.bTag.style.left = B.x + 'px';
    refs.bTag.style.top = (B.y - 330) + 'px';
    refs.bTag.innerHTML = '<span>BREAKER</span><b></b>';
  }

  /* ---- sell bin ---- */
  function buildBin() {
    L.binBack.innerHTML = ''; L.binFront.innerHTML = '';
    var BN = P(binX(), 0, 0), ns = 2.535 * K;
    refs.ns = ns;
    refs.binBackG = div(L.binBack, null, 'bingroup');
    refs.binFrontG = div(L.binFront, null, 'bingroup');
    spr(refs.binBackG, 'collector/bin_back.webp', 512, 512, ns, 256, 418, { x: 0, y: 0 });
    spr(refs.binFrontG, 'collector/bin_front.webp', 512, 512, ns, 256, 418, { x: 0, y: 0 });
    var ls = 3.093 * K;
    refs.lid = spr(refs.binFrontG, 'collector/bin_lid.webp', 512, 256, ls, 256, 16, { x: 0, y: (8 - 418) * ns });
    refs.lid.style.transformOrigin = (256 * ls) + 'px ' + (16 * ls) + 'px';
    placeBin(false);
  }
  function placeBin(animate) {
    var BN = P(binX(), 0, 0);
    [refs.binBackG, refs.binFrontG].forEach(function (g) {
      g.style.transition = animate ? 'transform .9s cubic-bezier(.5,0,.2,1)' : 'none';
      g.style.transform = 'translate(' + BN.x + 'px,' + BN.y + 'px)';
    });
  }
  function binTarget() {
    var BN = P(binX(), 0, 0), ns = refs.ns;
    return { x: BN.x, y: BN.y + (230 - 418) * ns };
  }

  /* ================= apply state to the scene ================= */
  function applyState() {
    var on = state.owned;
    world.classList.toggle('dim', !on);
    refs.hint.style.display = on ? 'none' : 'block';
    refs.pad.style.left = (P(padX(), 0, 0).x - 128 * 2.251 * K) + 'px';
    refs.bCover.style.display = state.breaker ? 'none' : 'block';
    refs.bGroup.style.display = state.breaker ? 'block' : 'none';
    refs.bTag.style.display = state.breaker ? 'none' : 'block';
    refs.bTag.querySelector('b').textContent = fmtMoney(BREAKER_PRICE);
    var gd = Math.max(2.2, 9 - state.speed * 0.14);
    refs.gearA.style.animationDuration = gd + 's';
    refs.gearB.style.animationDuration = (gd * 12 / 16) + 's';
    refs.bGearL.style.animationDuration = (gd * 0.8) + 's';
    refs.bGearR.style.animationDuration = (gd * 0.8) + 's';
    refs.beltDiv.style.animationDuration = (refs.beltPeriod / beltPx()).toFixed(3) + 's';
  }

  function setRunning(el, flag) { el.style.animationPlayState = flag ? 'running' : 'paused'; }

  function updateIndicators() {
    var full = state.owned && (cubes.length + pending) >= MAX_WAIT;
    var factoryOn = state.owned && !full;
    refs.full.style.display = (state.owned && full && !state.breaker) ? 'block' : 'none';
    refs.lampsOn.forEach(function (e) { e.style.display = factoryOn ? 'block' : 'none'; });
    refs.lampsOff.forEach(function (e) { e.style.display = factoryOn ? 'none' : 'block'; });
    setRunning(refs.gearA, factoryOn); setRunning(refs.gearB, factoryOn);
    var bOn = state.breaker && state.owned;
    refs.bLampOn.forEach(function (e) { e.style.display = bOn ? 'block' : 'none'; });
    refs.bLampOff.forEach(function (e) { e.style.display = bOn ? 'none' : 'block'; });
    setRunning(refs.bGearL, bOn && cubes.length > 0); setRunning(refs.bGearR, bOn && cubes.length > 0);
    setRunning(refs.beltDiv, moving);
  }

  /* ================= particles, tint, fx ================= */
  function getImg(path, cb) {
    var im = imgCache[path];
    if (im && im.complete && im.naturalWidth) { cb(im); return; }
    if (!im) { im = new Image(); imgCache[path] = im; im.src = G3 + path; }
    im.addEventListener('load', function () { cb(im); });
  }
  function tinted(path, color, cb) {
    var key = path + color;
    if (tintCache[key]) { cb(tintCache[key]); return; }
    getImg(path, function (im) {
      var c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      var x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(im, 0, 0);
      tintCache[key] = c.toDataURL('image/webp', 0.92);
      cb(tintCache[key]);
    });
  }

  function floatText(x, y, text, color, sub) {
    var d = document.createElement('div');
    d.className = 'ftxt';
    d.style.color = color;
    d.style.left = (x - 130) + 'px'; d.style.top = y + 'px';
    d.innerHTML = (sub ? '<small>' + sub + '</small>' : '') + text;
    L.fx.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1250);
  }

  function puff(x, y, size) {
    var im = new Image(); im.src = G3 + 'fx/dust_puff.webp'; im.className = 'sp fxs';
    im.style.left = (x - size / 2) + 'px'; im.style.top = (y - size / 2) + 'px';
    im.style.width = size + 'px'; im.style.height = size + 'px';
    L.fx.appendChild(im);
    var a = im.animate([{ transform: 'scale(.4)', opacity: .9 }, { transform: 'scale(1.25)', opacity: 0 }], { duration: 520, easing: 'ease-out' });
    a.onfinish = function () { if (im.parentNode) im.parentNode.removeChild(im); };
  }
  function spark(x, y, size) {
    var im = new Image(); im.src = G3 + 'fx/impact_spark.webp'; im.className = 'sp fxs';
    im.style.left = (x - size / 2) + 'px'; im.style.top = (y - size / 2) + 'px';
    im.style.width = size + 'px'; im.style.height = size + 'px';
    L.fx.appendChild(im);
    var a = im.animate([{ transform: 'scale(.3) rotate(0deg)', opacity: 1 }, { transform: 'scale(1) rotate(40deg)', opacity: 0 }], { duration: 300, easing: 'ease-out' });
    a.onfinish = function () { if (im.parentNode) im.parentNode.removeChild(im); };
  }
  function shardBurst(x, y, ti) {
    var color = TIERS[ti].color;
    for (var i = 0; i < 7; i++) {
      (function (i) {
        var n = (i % 6) + 1, el = new Image();
        el.className = 'sp fxs'; el.style.width = '34px'; el.style.height = '34px';
        el.style.left = '-17px'; el.style.top = '-17px';
        L.fx.appendChild(el);
        var path = 'fx/shard_' + n + '.webp';
        if (ti === 0) { el.src = G3 + path; } else { tinted(path, color, function (u) { el.src = u; }); }
        var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 160 + Math.random() * 230;
        parts.push({ el: el, x: x + (Math.random() - 0.5) * 30, y: y - 20, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: Math.random() * 360, vr: (Math.random() - 0.5) * 900, t: 0, life: 0.85 });
      })(i);
    }
  }
  function updateParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.t += dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + p.r.toFixed(0) + 'deg)';
      p.el.style.opacity = Math.max(0, 1 - Math.pow(p.t / p.life, 2));
      if (p.t >= p.life) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); parts.splice(i, 1); }
    }
  }
  function flash() { refs.flash.classList.remove('go'); void refs.flash.offsetWidth; refs.flash.classList.add('go'); }

  /* ================= production ================= */
  function schedule(delay, fn) { timers.push({ t: delay, fn: fn }); }

  function produce() {
    pending++;
    refs.press.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + refs.pressTravel + 'px)', offset: 0.42 }, { transform: 'translateY(0)' }], { duration: 480, easing: 'ease-in-out' });
    schedule(0.25, function () {
      refs.door.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.12)', offset: 0.3 }, { transform: 'scaleY(.12)', offset: 0.75 }, { transform: 'scaleY(1)' }], { duration: 900, easing: 'ease-in-out' });
    });
    schedule(0.4, spawnCube);
  }

  function spawnCube() {
    pending = Math.max(0, pending - 1);
    if (!running || !state.owned) return;
    var ti = rollTier(), tier = TIERS[ti];
    var el = document.createElement('div');
    el.className = 'cube' + (ti >= 3 ? ' glow' : '') + (ti === 8 ? ' ult' : '');
    el.style.setProperty('--gc', tier.color);
    var img = new Image(); img.src = G3 + 'cubes/' + tier.img + '.webp'; img.className = 'cimg';
    var crack = new Image(); crack.className = 'ccrack'; crack.style.display = 'none';
    el.appendChild(img); el.appendChild(crack);
    L.cubes.appendChild(el);
    var c = { el: el, crack: crack, tier: ti, hp: tier.hits, hits: 0, value: Math.max(1, Math.round(tier.value * valueMult())), x: HATCH_X + 0.1, t: 0, dead: false };
    cubes.push(c);
    place(c);
    if (ti >= 6) flash();
    if (ti >= 3) buzz(ti >= 6 ? 60 : 25);
  }

  function place(c) {
    var p = P(c.x, BELT_Y, 0);
    var em = Math.min(1, c.t / 0.35), e = 1 - (1 - em) * (1 - em);
    var s = (0.55 + 0.45 * e) * CUBE_SCALE;
    c.el.style.opacity = Math.min(1, em * 2.2);
    c.el.style.transform = 'translate(' + (p.x - 254 * K).toFixed(1) + 'px,' + (p.y - 421 * K).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
    c.el.style.transformOrigin = (254 * K) + 'px ' + (421 * K) + 'px';
  }

  function cubeCenter(c) { var p = P(c.x, BELT_Y, 0); return { x: p.x, y: p.y - 48 * CUBE_SCALE }; }

  /* ---- breaking ---- */
  function hitCube(c, byHammer) {
    if (c.dead) return;
    c.hits++;
    var cc = cubeCenter(c);
    spark(cc.x, cc.y - 12, 120);
    if (c.hits >= c.hp || byHammer === 'final') { breakCube(c); return; }
    var stage = Math.min(3, Math.max(1, Math.ceil(c.hits / c.hp * 3)));
    c.crack.src = G3 + 'fx/crack_' + stage + '.webp';
    c.crack.style.display = 'block';
    c.el.animate([{ marginLeft: '0px' }, { marginLeft: '-5px' }, { marginLeft: '5px' }, { marginLeft: '0px' }], { duration: 160 });
    buzz(10);
  }

  function breakCube(c) {
    if (c.dead) return;
    c.dead = true;
    var cc = cubeCenter(c), ti = c.tier;
    var i = cubes.indexOf(c); if (i >= 0) cubes.splice(i, 1);
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    shardBurst(cc.x, cc.y, ti);
    puff(cc.x, cc.y + 30, 150);
    if (ti >= 3) flash();
    buzz(ti >= 6 ? 70 : 28);
    /* what is left is a pile of shards that the belt carries to the bin */
    var el = new Image(); el.className = 'sp pile';
    var ps = 2.956 * K;
    el.style.width = (256 * ps) + 'px'; el.style.height = (192 * ps) + 'px';
    if (ti === 0) el.src = G3 + 'fx/shard_pile.webp'; else tinted('fx/shard_pile.webp', TIERS[ti].color, function (u) { el.src = u; });
    var inBreaker = state.breaker;
    (inBreaker ? L.cubes : L.piles).appendChild(el);
    var pile = { el: el, x: c.x, ti: ti, value: c.value, state: 'ride', t: 0, inB: inBreaker, px: 0, py: 0 };
    el.style.opacity = 0;
    piles.push(pile);
    placePile(pile);
    refreshAffordability();
  }

  function placePile(p) {
    var s;
    if (p.state === 'ride') { s = P(p.x, BELT_Y, 0); p.px = s.x; p.py = s.y - 22; }
    var sc = p.sc === undefined ? 1 : p.sc;
    p.el.style.transform = 'translate(' + (p.px - 128 * 2.956 * K).toFixed(1) + 'px,' + (p.py - 130 * 2.956 * K).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
    p.el.style.opacity = p.o === undefined ? Math.min(1, p.t / 0.15) : p.o;
  }

  function updatePiles(dt) {
    var vx = beltPx() * 1.0, endPx = beltEndPx();
    for (var i = piles.length - 1; i >= 0; i--) {
      var p = piles[i];
      p.t += dt;
      if (p.state === 'ride') {
        p.x += (vx / PXU) * dt;
        if (p.inB && P(p.x, 0, 0).x > P(XB + 2.4, 0, 0).x) { p.inB = false; L.piles.appendChild(p.el); }
        placePile(p);
        if (P(p.x, 0, 0).x >= endPx) {
          if (p.inB) { p.inB = false; L.piles.appendChild(p.el); }
          p.state = 'arc'; p.t = 0;
          p.sx = P(p.x, BELT_Y, 0).x; p.sy = P(p.x, BELT_Y, 0).y - 22;
          openLid();
        }
      } else if (p.state === 'arc') {
        var q = Math.min(1, p.t / 0.8), tg = binTarget();
        p.px = p.sx + (tg.x - p.sx) * q;
        p.py = p.sy + (tg.y - p.sy) * q - 130 * 4 * q * (1 - q);
        p.sc = 1 - 0.35 * q;
        p.o = 1;
        placePile(p);
        if (q >= 0.55 && !p.in) { p.in = true; }
        if (q >= 1) { sellPile(p); piles.splice(i, 1); }
      }
    }
  }

  function openLid() {
    refs.lid.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.12)', offset: 0.2 }, { transform: 'scaleY(.12)', offset: 0.75 }, { transform: 'scaleY(1)' }], { duration: 1000, easing: 'ease-in-out' });
  }

  function sellPile(p) {
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    addCash(p.value);
    var tg = binTarget();
    floatText(tg.x, tg.y - 150, '+' + fmtMoney(p.value), TIERS[p.ti].color, p.ti >= 3 ? TIERS[p.ti].name : '');
    refreshAffordability();
  }

  function addCash(n) {
    state.cash += n;
    refs.cash.textContent = fmtMoney(state.cash);
    refs.cash.classList.add('bump');
    setTimeout(function () { refs.cash.classList.remove('bump'); }, 120);
    markDirty();
  }

  /* ---- cubes moving along the belt ---- */
  function updateCubes(dt) {
    var vx = beltPx() / PXU, px = padX(), mv = false;
    cubes.sort(function (a, b) { return b.x - a.x; });
    for (var i = 0; i < cubes.length; i++) {
      var c = cubes[i];
      c.t += dt;
      var target = px - i * SPACE;
      if (c.t > 0.3 && c.x < target) { c.x = Math.min(target, c.x + vx * dt); mv = true; }
      place(c);
    }
    var anyPiles = piles.some(function (p) { return p.state === 'ride'; });
    moving = mv || anyPiles;
    /* automatic breaker */
    if (state.breaker && state.owned) {
      var f = cubes[0];
      if (f && !hammerBusy && Math.abs(f.x - px) < 0.05 && f.t > 0.5) {
        autoT += dt;
        if (autoT >= 0.25) { autoT = 0; strike(f); }
      } else if (!f) { autoT = 0; }
    }
  }

  function strike(c) {
    hammerBusy = true;
    refs.hammer.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + refs.hammerTravel + 'px)', offset: 0.35 }, { transform: 'translateY(' + refs.hammerTravel + 'px)', offset: 0.42 }, { transform: 'translateY(0)' }], { duration: AUTO_TIME * 1000 * 0.8, easing: 'ease-in-out' });
    schedule(AUTO_TIME * 0.8 * 0.35, function () { if (!c.dead) { breakCube(c); } });
    schedule(AUTO_TIME * 0.8 + 0.1, function () { hammerBusy = false; });
  }

  /* ================= main loop ================= */
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
      var room = (cubes.length + pending) < MAX_WAIT;
      var iv = interval();
      if (room) { acc += dt; if (acc >= iv) { acc = 0; produce(); } }
      else if (acc > iv) { acc = iv; }
    }
    updateCubes(dt);
    updatePiles(dt);
    updateParts(dt);
    updateIndicators();
    saveT += dt;
    if (saveT > 4) { saveT = 0; if (dirty) save(); }
  }

  /* ================= camera & input ================= */
  function layout() {
    if (!stage) return;
    var s = window.innerWidth / 720;
    var H = window.innerHeight / s;
    view.w = 720; view.h = H;
    stage.style.height = H + 'px';
    stage.style.transform = 'scale(' + s + ')';
    var panelH = refs.panel.offsetHeight || 220;
    refs.panel.style.bottom = '24px';
    refs.panel.style.top = 'auto';
    refs.panelTop = H - 24 - panelH;
    cam.base = Math.max(130, Math.min(refs.panelTop - 330, 215 + 433 * cam.s));
    if (!camSet) {
      camSet = true;
      cam.x = 8 - worldBounds().left * cam.s;
      cam.y = cam.base;
    }
    clampCam(); applyCam();
  }
  function clampCam() {
    var b = worldBounds();
    var minX = view.w - b.right * cam.s - 8, maxX = 8 - b.left * cam.s;
    if (minX > maxX) { minX = maxX = (minX + maxX) / 2; }
    cam.x = Math.max(minX, Math.min(maxX, cam.x));
    var base = cam.base || 500;
    cam.y = Math.max(base - 330, Math.min(base + 290, cam.y));
  }
  function applyCam() {
    world.style.transform = 'translate(' + cam.x.toFixed(1) + 'px,' + cam.y.toFixed(1) + 'px) scale(' + cam.s + ')';
  }
  function toWorld(cx, cy) {
    var s = window.innerWidth / 720;
    return { x: (cx / s - cam.x) / cam.s, y: (cy / s - cam.y) / cam.s };
  }

  function bindPointer() {
    var d = null;
    scene.addEventListener('pointerdown', function (e) {
      if (!running) return;
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
      try { scene.setPointerCapture(e.pointerId); } catch (er) {}
    });
    scene.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) return;
      var s = window.innerWidth / 720;
      var dx = (e.clientX - d.x) / s, dy = (e.clientY - d.y) / s;
      if (!d.moved && Math.sqrt(dx * dx + dy * dy) > 14) d.moved = true;
      if (d.moved) {
        cam.x = d.cx + dx; cam.y = d.cy + dy;
        clampCam(); applyCam();
        if (!panned && Math.abs(dx) > 40) { panned = true; refs.swipe.style.display = 'none'; }
      }
    });
    function end(e) {
      if (!d || e.pointerId !== d.id) return;
      var was = d; d = null;
      if (!was.moved && e.type === 'pointerup') tap(toWorld(e.clientX, e.clientY));
    }
    scene.addEventListener('pointerup', end);
    scene.addEventListener('pointercancel', function () { d = null; });
  }

  function tap(w) {
    if (!state.owned) return;
    /* cubes: nearest one within reach */
    var best = null, bd = 1e9;
    cubes.forEach(function (c) {
      if (c.t < 0.3) return;
      var cc = cubeCenter(c), dd = Math.sqrt(Math.pow(cc.x - w.x, 2) + Math.pow(cc.y - w.y, 2));
      if (dd < bd) { bd = dd; best = c; }
    });
    if (best && bd < 95) { hitCube(best); return; }
    /* locked breaker */
    if (!state.breaker) {
      var B = P(XB, 0, 0);
      if (Math.abs(w.x - B.x) < 200 && w.y > B.y - 400 && w.y < B.y + 20) { buyBreaker(); return; }
    }
    /* plots for sale */
    for (var i = 0; i < PLOTS.length; i++) {
      var r = PLOTS[i];
      if (state[r.key]) continue;
      var c2 = P((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      if (Math.abs(w.x - c2.x) < 70 && w.y > c2.y - 100 && w.y < c2.y + 70) { buyPlot(r); return; }
    }
  }

  /* ================= panel ================= */
  function effectText(key) {
    var lv = state[key], nx = Math.min(MAX_LV, lv + 1);
    if (key === 'speed') return interval(lv).toFixed(2) + 's  >  ' + interval(nx).toFixed(2) + 's per cube';
    if (key === 'luck')  return 'rare chance x' + luckMult(lv).toFixed(2) + '  >  x' + luckMult(nx).toFixed(2);
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
  function refreshAll() { renderHud(); renderPanel(); applyState(); layout(); }

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

  /* ================= actions ================= */
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  function buyFactory() {
    if (state.owned) return;
    if (state.cash < FACTORY_PRICE) { shake($('gBuy')); return; }
    state.cash -= FACTORY_PRICE; state.owned = true; acc = BASE_INTERVAL - 1.2;
    save(); buzz(40); flash();
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
  function buyBreaker() {
    if (state.breaker) return;
    if (state.cash < BREAKER_PRICE) { shake(refs.bTag); buzz(30); return; }
    state.cash -= BREAKER_PRICE; state.breaker = true;
    save(); buzz(60); flash();
    /* the bin moves to the right of the breaker, the belt grows */
    piles.slice().forEach(function (p) { sellPile(p); });
    piles = [];
    buildBelt(); buildBin(); placeBin(false);
    lastAfford = ''; refreshAll(); refreshAffordability();
    focusX(P(XB, 0, 0).x);
  }
  function focusX(wx) {
    cam.x = view.w / 2 - wx * cam.s;
    clampCam();
    world.style.transition = 'transform .9s ease-in-out';
    applyCam();
    setTimeout(function () { world.style.transition = 'none'; }, 950);
  }
  function buyPlot(r) {
    if (state[r.key]) return;
    if (state.cash < r.price) { buzz(30); return; }
    state.cash -= r.price; state[r.key] = true;
    save(); buzz(50); flash();
    L.floor.innerHTML = ''; buildFloor(L.floor); buildPlotLabels();
    lastAfford = ''; refreshAll(); refreshAffordability();
  }
  function onPanelClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var b = t.closest('#gBuy'); if (b) { buyFactory(); return; }
    var u = t.closest('.ubuy'); if (u) buyUpgrade(u.getAttribute('data-k'));
  }

  function openOdds() {
    var p = odds(), h = '';
    $('oddsSub').textContent = 'Factory level ' + factoryLevel() + ' / ' + MAX_FACTORY_LV + '  -  Luck x' + luckMult().toFixed(2);
    TIERS.forEach(function (t, i) {
      var open = unlocked(t);
      h += '<div class="orow' + (open ? '' : ' lock') + '"><img src="' + G3 + 'cubes/' + t.img + '.webp" alt="">' +
        '<span class="on" style="color:' + t.color + '">' + t.name + '</span>' +
        '<span class="op">' + (open ? fmtPct(p[i]) : 'UNLOCKS AT LV ' + t.unlock) + '</span></div>';
    });
    $('oddsRows').innerHTML = h;
    $('gOddsPanel').classList.remove('hidden');
  }
  function closeOdds() { $('gOddsPanel').classList.add('hidden'); }

  /* ================= show / hide ================= */
  function show() {
    if (!root) { load(); build(); }
    root.classList.remove('hidden');
    lastAfford = '';
    refs.swipe.style.display = panned ? 'none' : 'flex';
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
        cubes.forEach(function (c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
        piles.forEach(function (p) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); });
        cubes = []; piles = []; timers = []; pending = 0; hammerBusy = false; autoT = 0;
      }
    }, 460);
    if (window.__menuBack) window.__menuBack();
  }

  function devAdd(n) {
    if (!root) return;
    state.cash += n; save();
    renderHud(); lastAfford = ''; refreshAffordability();
  }

  window.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', function () { if (document.hidden && root) save(); });
  window.addEventListener('pagehide', function () { if (root) save(); });

  window.CubeGame = {
    show: show,
    hide: hide,
    dev: devAdd,
    _test: { state: state, odds: odds, tiers: TIERS, factoryLevel: factoryLevel, interval: interval, cost: upgradeCost, roll: rollTier,
             cubes: function () { return cubes; }, piles: function () { return piles; }, cam: cam, tap: tap, hit: hitCube }
  };
})();
