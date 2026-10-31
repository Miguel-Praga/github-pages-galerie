// qr.js — QR kód a QR Platba bez knihoven
//
// Kodér umí jen to, co QR Platba potřebuje: bajtový režim a úroveň
// opravy M (doporučená specifikací České bankovní asociace). Postup
// sleduje normu ISO/IEC 18004 — Reed-Solomon nad GF(256), prokládání
// bloků, osm masek a výběr té s nejnižší penalizací.

(function (G) {
  'use strict';

  // Úroveň M, index = verze 1..40
  const ECC_NA_BLOK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const POCET_BLOKU = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0; // dvoubitový kód úrovně M ve formátové informaci

  function surovychModulu(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const zarovnani = Math.floor(ver / 7) + 2;
      n -= (25 * zarovnani - 10) * zarovnani - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  const datovychSlov = (ver) => Math.floor(surovychModulu(ver) / 8) - ECC_NA_BLOK[ver] * POCET_BLOKU[ver];

  // --- Reed-Solomon ---------------------------------------------------------
  function nasob(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function delitel(stupen) {
    const v = new Array(stupen).fill(0);
    v[stupen - 1] = 1;
    let koren = 1;
    for (let i = 0; i < stupen; i++) {
      for (let j = 0; j < v.length; j++) {
        v[j] = nasob(v[j], koren);
        if (j + 1 < v.length) v[j] ^= v[j + 1];
      }
      koren = nasob(koren, 0x02);
    }
    return v;
  }
  function zbytek(data, del) {
    const v = new Array(del.length).fill(0);
    for (const b of data) {
      const f = b ^ v.shift();
      v.push(0);
      del.forEach((c, i) => { v[i] ^= nasob(c, f); });
    }
    return v;
  }

  function pridejOpravuAProloz(data, ver) {
    const bloku = POCET_BLOKU[ver];
    const eccDelka = ECC_NA_BLOK[ver];
    const surovych = Math.floor(surovychModulu(ver) / 8);
    const kratkych = bloku - (surovych % bloku);
    const kratkaDelka = Math.floor(surovych / bloku);
    const del = delitel(eccDelka);
    const bloky = [];
    for (let i = 0, k = 0; i < bloku; i++) {
      const dat = data.slice(k, k + kratkaDelka - eccDelka + (i < kratkych ? 0 : 1));
      k += dat.length;
      const ecc = zbytek(dat, del);
      if (i < kratkych) dat.push(0);
      bloky.push(dat.concat(ecc));
    }
    const vysledek = [];
    for (let i = 0; i < bloky[0].length; i++) {
      bloky.forEach((blok, j) => {
        if (i !== kratkaDelka - eccDelka || j >= kratkych) vysledek.push(blok[i]);
      });
    }
    return vysledek;
  }

  // --- matice ---------------------------------------------------------------
  function zakoduj(text, vynucenaMaska) {
    const bajty = new TextEncoder().encode(text);
    let ver = 1;
    for (; ver <= 40; ver++) {
      const delkaPocitadla = ver < 10 ? 8 : 16;
      if (4 + delkaPocitadla + bajty.length * 8 <= datovychSlov(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Text je na QR kód příliš dlouhý.');

    const bity = [];
    const pridej = (hodnota, delka) => {
      for (let i = delka - 1; i >= 0; i--) bity.push((hodnota >>> i) & 1);
    };
    const kapacita = datovychSlov(ver) * 8;
    pridej(0b0100, 4);
    pridej(bajty.length, ver < 10 ? 8 : 16);
    bajty.forEach((b) => pridej(b, 8));
    pridej(0, Math.min(4, kapacita - bity.length));
    pridej(0, (8 - (bity.length % 8)) % 8);
    for (let vypln = 0xec; bity.length < kapacita; vypln ^= 0xec ^ 0x11) pridej(vypln, 8);

    const slova = [];
    for (let i = 0; i < bity.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bity[i + j];
      slova.push(b);
    }

    const vel = ver * 4 + 17;
    const m = Array.from({ length: vel }, () => new Array(vel).fill(false));
    const fce = Array.from({ length: vel }, () => new Array(vel).fill(false));
    const nastav = (x, y, tmavy) => { m[y][x] = tmavy; fce[y][x] = true; };

    // časování
    for (let i = 0; i < vel; i++) {
      nastav(6, i, i % 2 === 0);
      nastav(i, 6, i % 2 === 0);
    }
    // vyhledávací vzory s oddělovačem
    const hledac = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx; const y = cy + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < vel && y >= 0 && y < vel) nastav(x, y, d !== 2 && d !== 4);
        }
      }
    };
    hledac(3, 3); hledac(vel - 4, 3); hledac(3, vel - 4);
    // zarovnávací vzory
    const pozice = [];
    if (ver > 1) {
      const pocet = Math.floor(ver / 7) + 2;
      const krok = Math.floor((ver * 8 + pocet * 3 + 5) / (pocet * 4 - 4)) * 2;
      pozice.push(6);
      for (let p = vel - 7; pozice.length < pocet; p -= krok) pozice.splice(1, 0, p);
    }
    pozice.forEach((a, i) => pozice.forEach((b, j) => {
      const roh = (i === 0 && j === 0) || (i === 0 && j === pozice.length - 1) || (i === pozice.length - 1 && j === 0);
      if (roh) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) nastav(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));

    const formatovaInformace = (maska) => {
      const data = (FORMAT_M << 3) | maska;
      let zb = data;
      for (let i = 0; i < 10; i++) zb = (zb << 1) ^ ((zb >>> 9) * 0x537);
      const b = ((data << 10) | zb) ^ 0x5412;
      const bit = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) nastav(8, i, bit(i));
      nastav(8, 7, bit(6));
      nastav(8, 8, bit(7));
      nastav(7, 8, bit(8));
      for (let i = 9; i < 15; i++) nastav(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) nastav(vel - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) nastav(8, vel - 15 + i, bit(i));
      nastav(8, vel - 8, true);
    };
    formatovaInformace(0); // jen vyhradí místo, skutečné bity přijdou s maskou

    if (ver >= 7) {
      let zb = ver;
      for (let i = 0; i < 12; i++) zb = (zb << 1) ^ ((zb >>> 11) * 0x1f25);
      const b = (ver << 12) | zb;
      for (let i = 0; i < 18; i++) {
        const tmavy = ((b >>> i) & 1) !== 0;
        const a = vel - 11 + (i % 3);
        const c = Math.floor(i / 3);
        nastav(a, c, tmavy);
        nastav(c, a, tmavy);
      }
    }

    // datové moduly cik-cak po dvou sloupcích zdola nahoru a zpět
    const vsechna = pridejOpravuAProloz(slova, ver);
    let i = 0;
    for (let vpravo = vel - 1; vpravo >= 1; vpravo -= 2) {
      if (vpravo === 6) vpravo = 5;
      for (let svisle = 0; svisle < vel; svisle++) {
        for (let j = 0; j < 2; j++) {
          const x = vpravo - j;
          const nahoru = ((vpravo + 1) & 2) === 0;
          const y = nahoru ? vel - 1 - svisle : svisle;
          if (!fce[y][x] && i < vsechna.length * 8) {
            m[y][x] = ((vsechna[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }

    const maskuj = (maska) => {
      for (let y = 0; y < vel; y++) {
        for (let x = 0; x < vel; x++) {
          let obrat;
          switch (maska) {
            case 0: obrat = (x + y) % 2 === 0; break;
            case 1: obrat = y % 2 === 0; break;
            case 2: obrat = x % 3 === 0; break;
            case 3: obrat = (x + y) % 3 === 0; break;
            case 4: obrat = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: obrat = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: obrat = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: obrat = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          }
          if (!fce[y][x] && obrat) m[y][x] = !m[y][x];
        }
      }
    };

    let maska = vynucenaMaska;
    if (maska == null) {
      let nejmene = Infinity;
      for (let k = 0; k < 8; k++) {
        maskuj(k);
        formatovaInformace(k);
        const p = penalizace(m);
        if (p < nejmene) { nejmene = p; maska = k; }
        maskuj(k); // XOR podruhé masku vrátí
      }
    }
    maskuj(maska);
    formatovaInformace(maska);
    return { verze: ver, maska, moduly: m };
  }

  // Penalizace podle normy: řady stejné barvy, bloky 2×2, vzory podobné
  // vyhledávacím a nevyváženost tmavých a světlých modulů.
  function penalizace(m) {
    const vel = m.length;
    let p = 0;
    const pridejHistorii = (delka, hist) => {
      if (hist[0] === 0) delka += vel;
      hist.pop();
      hist.unshift(delka);
    };
    const vzory = (hist) => {
      const n = hist[1];
      const jadro = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
      return (jadro && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (jadro && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
    };
    const linie = (bunka) => {
      for (let a = 0; a < vel; a++) {
        let barva = false; let delka = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < vel; b++) {
          if (bunka(a, b) === barva) {
            delka++;
            if (delka === 5) p += 3;
            else if (delka > 5) p++;
          } else {
            pridejHistorii(delka, hist);
            if (!barva) p += vzory(hist) * 40;
            barva = bunka(a, b);
            delka = 1;
          }
        }
        if (barva) { pridejHistorii(delka, hist); delka = 0; }
        delka += vel;
        pridejHistorii(delka, hist);
        p += vzory(hist) * 40;
      }
    };
    linie((y, x) => m[y][x]);
    linie((x, y) => m[y][x]);
    let tmavych = 0;
    for (let y = 0; y < vel; y++) {
      for (let x = 0; x < vel; x++) {
        if (m[y][x]) tmavych++;
        if (y < vel - 1 && x < vel - 1) {
          const c = m[y][x];
          if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
        }
      }
    }
    const celkem = vel * vel;
    p += (Math.ceil(Math.abs(tmavych * 20 - celkem * 10) / celkem) - 1) * 10;
    return p;
  }

  // SVG s tichou zónou 4 moduly; barvy řeší CSS (.qr)
  function svg(text, popisek) {
    const { moduly } = zakoduj(text);
    const vel = moduly.length;
    const okraj = 4;
    let d = '';
    moduly.forEach((radek, y) => radek.forEach((tmavy, x) => {
      if (tmavy) d += `M${x + okraj},${y + okraj}h1v1h-1z`;
    }));
    const s = vel + okraj * 2;
    return G.h('svg:svg', {
      class: 'qr', viewBox: `0 0 ${s} ${s}`, role: 'img', 'aria-label': popisek || 'QR kód',
      'shape-rendering': 'crispEdges',
    }, G.h('svg:rect', { class: 'qr-pozadi', width: s, height: s }), G.h('svg:path', { class: 'qr-moduly', d }));
  }

  // --- účet a QR Platba -----------------------------------------------------
  function mod97(cislice) {
    let zb = 0;
    for (const c of cislice) zb = (zb * 10 + Number(c)) % 97;
    return zb;
  }

  // Kontrolní součet českého čísla účtu (vyhláška ČNB 169/2011)
  function kontrolaCasti(cast, vahy) {
    const c = cast.padStart(vahy.length, '0');
    let soucet = 0;
    for (let i = 0; i < vahy.length; i++) soucet += Number(c[i]) * vahy[i];
    return soucet % 11 === 0;
  }

  // '19-2000145399/0800' nebo 'CZ65 0800 …' → {iban, chyba}
  function ucetNaIban(zapis) {
    const s = String(zapis || '').replace(/\s+/g, '').toUpperCase();
    if (!s) return { iban: '', chyba: 'Číslo účtu chybí.' };
    if (/^CZ\d{22}$/.test(s)) {
      const platny = mod97(s.slice(4) + '1235' + s.slice(2, 4)) === 1;
      return platny ? { iban: s } : { iban: '', chyba: 'IBAN má špatnou kontrolní číslici.' };
    }
    const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
    if (!m) return { iban: '', chyba: 'Zadejte účet ve tvaru 123456789/0800 nebo 19-123456789/0800.' };
    const predcisli = m[1] || '';
    const cislo = m[2];
    if (!kontrolaCasti(predcisli, [10, 5, 8, 4, 2, 1]) || !kontrolaCasti(cislo, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1])) {
      return { iban: '', chyba: 'Číslo účtu nesedí na kontrolní součet — zkontrolujte překlep.' };
    }
    const bban = m[3] + predcisli.padStart(6, '0') + cislo.padStart(10, '0');
    const kontrola = String(98 - mod97(bban + '123500')).padStart(2, '0');
    return { iban: 'CZ' + kontrola + bban };
  }

  const ciste = (text, max) => G.bezDiakritiky(text).replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  // Formát Short Payment Descriptor (SPD 1.0)
  function platba({ iban, castka, vs, zprava, prijemce }) {
    const casti = ['SPD', '1.0', 'ACC:' + iban];
    if (castka > 0) casti.push('AM:' + Number(castka).toFixed(2));
    casti.push('CC:CZK');
    if (zprava) casti.push('MSG:' + ciste(zprava, 60));
    if (prijemce) casti.push('RN:' + ciste(prijemce, 35));
    if (vs) casti.push('X-VS:' + String(vs).replace(/\D/g, '').slice(0, 10));
    return casti.join('*');
  }

  G.qr = { zakoduj, svg, platba, ucetNaIban };
})(window.Galerie);
