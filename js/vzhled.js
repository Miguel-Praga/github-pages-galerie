// vzhled.js — běží v <head> ještě před vykreslením stránky
//
// Nastaví barvy z minulé návštěvy (web.js si je ukládá), aby stránka
// neproblikla výchozím stylem, a stránku schová, dokud web.js nenačte
// data. Když se něco zasekne, ukáže ji nejpozději za 2,5 s.

(function () {
  'use strict';
  var html = document.documentElement;
  html.classList.add('ceka');
  setTimeout(function () { html.classList.remove('ceka'); }, 2500);
  try {
    var ulozeny = JSON.parse(localStorage.getItem('galerie.vzhled'));
    if (!ulozeny) return;
    var tmavy = ulozeny.pevny ? ulozeny.pevny === 'tmavy' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var tokeny = tmavy ? ulozeny.tmavy : ulozeny.svetly;
    for (var k in tokeny) html.style.setProperty('--' + k, tokeny[k]);
    html.style.setProperty('color-scheme', tmavy ? 'dark' : 'light');
    html.dataset.ramy = ulozeny.ramy || 'zadne';
    html.dataset.velikost = ulozeny.velikost || 'stredni';
  } catch (e) { /* bez uloženého vzhledu platí výchozí z CSS */ }
})();
