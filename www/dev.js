/* DEV TOOL - delete this file and its <script> tag in index.html before release */
(function () {
  'use strict';
  var AMOUNT = 10000;
  function ensure() {
    var g = document.getElementById('game');
    if (!g || document.getElementById('gDev') || !window.CubeGame || !window.CubeGame.dev) return;
    var b = document.createElement('button');
    b.id = 'gDev';
    b.type = 'button';
    b.textContent = 'DEV +$10K';
    b.style.cssText = 'position:absolute;left:18px;top:112px;z-index:9;padding:10px 16px;border-radius:14px;border:3px solid #0a0d18;background:#2fbf5a;color:#fff;font:700 22px system-ui,sans-serif;letter-spacing:.04em;-webkit-tap-highlight-color:transparent;touch-action:manipulation';
    b.addEventListener('click', function (e) { e.stopPropagation(); window.CubeGame.dev(AMOUNT); });
    var st = document.getElementById('stage');
    (st || g).appendChild(b);
  }
  setInterval(ensure, 400);
})();
