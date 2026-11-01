// zaklad.js — drobnosti, které potřebuje web i správa
//
// Všechno, co pochází z dat (názvy, popisy), jde do stránky přes
// textContent. innerHTML se nepoužívá nikde, takže popisek s HTML
// v sobě se ukáže jako text a nic nespustí.

window.Galerie = (function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';

  // h('a', {href: '#', class: 'odkaz', onclick: fn}, 'text', dite, [dalsi])
  function h(znacka, vlastnosti, ...deti) {
    const svg = znacka.startsWith('svg:');
    const el = svg ? document.createElementNS(SVG, znacka.slice(4)) : document.createElement(znacka);
    for (const [klic, hodnota] of Object.entries(vlastnosti || {})) {
      if (hodnota == null || hodnota === false) continue;
      if (klic.startsWith('on')) el.addEventListener(klic.slice(2), hodnota);
      else if (klic === 'text') el.textContent = hodnota;
      else if (klic === 'dataset') Object.assign(el.dataset, hodnota);
      else if (klic === 'styl') for (const [p, v] of Object.entries(hodnota)) el.style.setProperty(p, v);
      else if (klic === 'value' && !svg) el.value = hodnota;
      else if (klic === 'checked' && !svg) { el.checked = true; el.defaultChecked = true; }
      else el.setAttribute(klic, hodnota === true ? '' : hodnota);
    }
    for (const d of deti.flat(Infinity)) {
      if (d == null || d === false) continue;
      el.append(d instanceof Node ? d : String(d));
    }
    return el;
  }

  const $ = (vyber, koren) => (koren || document).querySelector(vyber);
  const $$ = (vyber, koren) => Array.from((koren || document).querySelectorAll(vyber));

  // Prázdný řádek dělí odstavce, jednoduchý zalomení zůstane zalomením.
  function odstavce(text) {
    return String(text || '').trim().split(/\n\s*\n/).filter(Boolean).map((odst) => {
      const p = h('p');
      odst.split('\n').forEach((radek, i) => {
        if (i) p.append(h('br'));
        p.append(radek);
      });
      return p;
    });
  }

  const STAVY = {
    vystaveno: 'Jen k vidění',
    dostupne: 'K dispozici',
    rezervovano: 'Rezervováno',
    sbirka: 'V soukromé sbírce',
  };

  // Starší data znala „prodej“ a „prodáno“ — převedou se na dnešní stavy.
  const STARE_STAVY = { prodej: 'dostupne', prodano: 'sbirka' };
  const stavDila = (d) => STARE_STAVY[d.stav] || (STAVY[d.stav] ? d.stav : 'vystaveno');

  const TEXT_ZAJMU = 'Pokud se vám některý obraz líbí, je možné ho zakoupit. V takovém případě mě prosím kontaktujte — vše domluvíme individuálně.';
  function nastaveniZajmu(n) {
    const stare = n && n.obchod;
    return Object.assign({ zapnuto: !!(stare && stare.zapnuto), text: TEXT_ZAJMU }, n && n.zajem);
  }

  // Ocenění autorky — nepovinná částka v celých korunách; u díla
  // v soukromé sbírce se neukazuje ani neukládá.
  const maOceneni = (d) => Number.isInteger(d.oceneni) && d.oceneni > 0 && stavDila(d) !== 'sbirka';
  const castka = (n) => new Intl.NumberFormat('cs-CZ').format(n) + ' Kč';

  function bezDiakritiky(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function slug(text) {
    return bezDiakritiky(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'obraz';
  }

  function nahodne(delka) {
    const znaky = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bajty = crypto.getRandomValues(new Uint8Array(delka));
    return Array.from(bajty, (b) => znaky[b % znaky.length]).join('');
  }

  // Úložiště prohlížeče umí v anonymním okně nebo s blokovanými daty
  // vyhodit výjimku — pak se prostě nic nepamatuje.
  function precti(uloziste, klic, vychozi) {
    try {
      const v = uloziste.getItem(klic);
      return v == null ? vychozi : JSON.parse(v);
    } catch (e) {
      return vychozi;
    }
  }
  function zapis(uloziste, klic, hodnota) {
    try {
      if (hodnota == null) uloziste.removeItem(klic);
      else uloziste.setItem(klic, JSON.stringify(hodnota));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Cesta k obrázku z dat je vždycky od kořene webu (obrazy/…, ukazka/…).
  // Správa sedí o složku níž, proto si předá předponu '../'.
  function adresaObrazku(cesta, predpona) {
    if (!cesta) return '';
    if (/^(https?:|data:|blob:)/.test(cesta)) return cesta;
    return (predpona || '') + cesta;
  }

  // --- vzhled ---------------------------------------------------------------
  // Styl = sada barev pro světlý a tmavý režim. Web i náhled ve Správě si
  // z něj spočítají CSS proměnné a nastaví je přes style.setProperty —
  // to Content-Security-Policy dovoluje, vložený <style> by neprošel.
  const SPOLECNE = {
    svetly: { dostupne: '#2f6a5f', rezervace: '#a7741c', sbirka: '#8a8178',
      stin: '0 1px 2px rgb(40 30 20 / 6%), 0 10px 30px -12px rgb(40 30 20 / 22%)' },
    tmavy: { dostupne: '#7cc0b1', rezervace: '#e0b25c', sbirka: '#9a9085',
      stin: '0 1px 2px rgb(0 0 0 / 30%), 0 14px 34px -14px rgb(0 0 0 / 70%)' },
  };

  const VZHLEDY = {
    papir: {
      nazev: 'Teplý papír', popis: 'krémový papír a terakota',
      svetly: { papir: '#f6f2eb', karta: '#fffdf9', inkoust: '#27231f', sede: '#6e665d', slabe: '#9a9187', linka: '#e3dacd', akcent: '#a6472a', ram: '#fffefb', zavoj: 'rgb(28 24 21 / 72%)' },
      tmavy: { papir: '#171513', karta: '#211e1b', inkoust: '#ece5da', sede: '#b0a698', slabe: '#857c71', linka: '#38322c', akcent: '#e08a63', ram: '#2a2622', zavoj: 'rgb(8 7 6 / 86%)' },
    },
    bila: {
      nazev: 'Bílá galerie', popis: 'čistá bílá stěna a černé písmo',
      svetly: { papir: '#ffffff', karta: '#ffffff', inkoust: '#151515', sede: '#5c5c5c', slabe: '#989898', linka: '#e8e8e8', akcent: '#151515', ram: '#ffffff', zavoj: 'rgb(248 248 248 / 92%)' },
      tmavy: { papir: '#0f0f0f', karta: '#181818', inkoust: '#f1f1f1', sede: '#a8a8a8', slabe: '#777777', linka: '#2c2c2c', akcent: '#f1f1f1', ram: '#1f1f1f', zavoj: 'rgb(0 0 0 / 88%)' },
    },
    tma: {
      nazev: 'Tmavá stěna', popis: 'obrazy svítí na tmavém pozadí', jenTmavy: true,
      tmavy: { papir: '#1b1d20', karta: '#24272b', inkoust: '#ece8e1', sede: '#a9a49b', slabe: '#7c7870', linka: '#34383d', akcent: '#c9a45c', ram: '#f3efe7', zavoj: 'rgb(10 11 12 / 88%)' },
    },
    pastel: {
      nazev: 'Pastelky', popis: 'jemná růžová, hravější',
      svetly: { papir: '#fbf5f8', karta: '#ffffff', inkoust: '#3b2f40', sede: '#76687c', slabe: '#a597a9', linka: '#efdfe8', akcent: '#c8507a', ram: '#ffffff', zavoj: 'rgb(59 47 64 / 60%)' },
      tmavy: { papir: '#1d1720', karta: '#271f2b', inkoust: '#f2e9f3', sede: '#bcaec0', slabe: '#8a7b8e', linka: '#3b2f40', akcent: '#f08aac', ram: '#2f2633', zavoj: 'rgb(10 6 12 / 85%)' },
    },
    salvej: {
      nazev: 'Šalvěj', popis: 'klidná zelená',
      svetly: { papir: '#f0f3ee', karta: '#fbfcfa', inkoust: '#1f2a24', sede: '#5b6a61', slabe: '#8f9c93', linka: '#d9e2d6', akcent: '#4b7656', ram: '#fdfdfb', zavoj: 'rgb(20 28 23 / 70%)' },
      tmavy: { papir: '#131915', karta: '#1b231e', inkoust: '#e4ece6', sede: '#a4b3a9', slabe: '#768279', linka: '#2c3830', akcent: '#8cc29a', ram: '#222b25', zavoj: 'rgb(5 8 6 / 86%)' },
    },
  };

  // Jen systémová písma — web tak nic nestahuje z cizích serverů.
  // Každá sada má zálohy pro Windows, Apple i Android.
  const PISMA = {
    klasicke: { nazev: 'Klasické patkové', rodina: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", "Noto Serif", Georgia, serif', vaha: 500 },
    moderni: { nazev: 'Moderní patkové', rodina: '"Iowan Old Style", Charter, "Bitstream Charter", "Sitka Heading", Cambria, "Noto Serif", Georgia, serif', vaha: 500 },
    bezpatkove: { nazev: 'Čisté bezpatkové', rodina: '"Avenir Next", "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif', vaha: 300 },
    rucni: { nazev: 'Ručně psané', rodina: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive', vaha: 400 },
  };

  function naHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let hue = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hue *= 60;
    }
    return [hue, s * 100, l * 100];
  }
  function zHsl(hue, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const posunJas = (hex, o) => { const [hue, s, l] = naHsl(hex); return zHsl(hue, s, Math.max(0, Math.min(100, l + o))); };
  // relativní jas podle WCAG (0 černá … 1 bílá)
  function jas(hex) {
    const kanal = (i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
  }
  // Text na tlačítku: bílý, nebo tmavý — podle toho, co má vůči barvě
  // větší kontrast. Tmavý #1b1714 má jas zhruba 0,009.
  const jeSvetla = (hex) => (jas(hex) + 0.05) / 0.059 > 1.05 / (jas(hex) + 0.05);

  // Vlastní barva musí být čitelná i jako odkaz: na světlém pozadí ji
  // ztmavujeme, dokud nemá vůči bílé kontrast aspoň 3:1, na tmavém
  // zesvětlujeme, dokud nevynikne (kontrast vůči pozadí zhruba 4:1).
  function barvaAkcentu(hex, tmavy) {
    const [hue, s, l0] = naHsl(hex);
    let l = l0;
    let barva = hex.toLowerCase();
    if (tmavy) while (jas(barva) < 0.2 && l < 96) { l += 2; barva = zHsl(hue, s, l); }
    else while (jas(barva) > 0.3 && l > 4) { l -= 2; barva = zHsl(hue, s, l); }
    return barva;
  }

  function tokenyVzhledu(v, tmavySystem) {
    v = v || {};
    const styl = VZHLEDY[v.styl] || VZHLEDY.papir;
    const tmavy = !!(styl.jenTmavy || v.rezim === 'tmavy' || (v.rezim !== 'svetly' && tmavySystem));
    const sada = tmavy ? styl.tmavy : styl.svetly;
    const t = Object.assign({}, SPOLECNE[tmavy ? 'tmavy' : 'svetly'], sada);
    const akcent = /^#[0-9a-f]{6}$/i.test(v.akcent || '') ? barvaAkcentu(v.akcent, tmavy) : sada.akcent;
    t.akcent = akcent;
    t['akcent-tmavy'] = posunJas(akcent, tmavy ? 10 : -10);
    t['na-akcentu'] = jeSvetla(akcent) ? '#1b1714' : '#ffffff';
    const pismo = PISMA[v.pismo] || PISMA.klasicke;
    t.patky = pismo.rodina;
    t['vaha-nadpisu'] = String(pismo.vaha);
    return { tokeny: t, tmavy };
  }

  function pouzijVzhled(el, v, tmavySystem) {
    const vysledek = tokenyVzhledu(v, tmavySystem);
    for (const [k, hodnota] of Object.entries(vysledek.tokeny)) el.style.setProperty('--' + k, hodnota);
    el.style.setProperty('color-scheme', vysledek.tmavy ? 'dark' : 'light');
    el.dataset.ramy = (v && v.ramy) || 'zadne';
    el.dataset.velikost = (v && v.velikost) || 'stredni';
    return vysledek;
  }

  return {
    h, $, $$, odstavce, STAVY, stavDila, TEXT_ZAJMU, nastaveniZajmu, maOceneni, castka, bezDiakritiky, slug, nahodne, precti, zapis, adresaObrazku,
    VZHLEDY, PISMA, tokenyVzhledu, pouzijVzhled,
  };
})();
