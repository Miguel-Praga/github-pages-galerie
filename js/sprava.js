// sprava.js — administrace galerie
//
// Všechny úpravy se drží v paměti a teprve „Zveřejnit změny“ je zapíše
// najednou (na GitHubu jedním commitem). Fotky se zmenšují už tady
// v prohlížeči — velký obrázek na 2000 px, náhled do mřížky na 900 px —
// takže do repozitáře nejdou mnohamegové originály z foťáku.

(function () {
  'use strict';

  const G = window.Galerie;
  const U = window.Uloziste;
  const { h, $, $$, cena } = G;

  const RELACE = 'galerie.relace'; // sessionStorage: {repo, klic, vetev, uzivatel}
  const ULOZENY = 'galerie.klic';  // localStorage: zašifrovaný klíč pro tohle zařízení
  const ROLE = { admin: 'správce', spravkyne: 'správkyně' };
  const MIN_HESLO = 10;
  const VELKY = 2000;
  const NAHLED = 900;
  const PORTRET = 1000;

  const S = {
    uloziste: null,
    data: null,
    puvodni: '',             // JSON při posledním načtení/uložení — podle něj se pozná, co je neuložené
    puvodniDila: new Map(),  // id → JSON díla, kvůli štítkům „nové“ / „upravené“
    verze: null,
    nove: new Map(),         // cesta → Blob, čeká na nahrání
    smazat: new Set(),       // cesty souborů ke smazání
    nahledy: new Map(),      // cesta → blob: URL, ať jsou vidět i obrázky, které ještě nejsou na webu
    editovane: null,
    tazene: null,
    vychoziRepo: '',
    vychoziVetev: '',
    hlidani: null,
    klic: '',                // přístupový klíč aktuálního přihlášení (jen v paměti a v sessionStorage)
    uzivatel: null,          // {jmeno, zobrazit, role, ucet, zmenitHeslo}
    ucty: [],                // veřejný seznam účtů pro přihlašovací obrazovku
    upravovanyUcet: null,    // jméno účtu, kterému správce mění heslo/klíč
    nahledTmavy: window.matchMedia('(prefers-color-scheme: dark)').matches,
  };

  const editor = $('#editor');
  const formEditor = $('[data-editor]');
  const formNastaveni = $('[data-nastaveni]');

  // =========================================================================
  // přihlášení
  // =========================================================================
  async function start() {
    let verejna = null;
    try {
      const odp = await fetch('../data/galerie.json', { cache: 'no-cache' });
      if (odp.ok) verejna = await odp.json();
    } catch (e) { /* bez veřejných dat to jde taky */ }
    const n = (verejna && verejna.nastaveni) || {};
    $$('[data-nazev-webu]').forEach((el) => { el.textContent = n.nazev || 'Galerie'; });
    S.vychoziRepo = n.repo || U.repoZAdresy();
    S.vychoziVetev = n.vetev || '';

    navazPrihlaseni();

    if (await U.lokalniDostupne()) { ukazPrihlaseni('lokalni'); return; }

    const relace = G.precti(sessionStorage, RELACE, null);
    if (relace && relace.klic) {
      try {
        await prihlas(U.github(relace.repo, relace.klic, relace.vetev), relace.klic, relace.uzivatel);
        return;
      } catch (e) {
        G.zapis(sessionStorage, RELACE, null);
        chybaPrihlaseni(e.message);
      }
    }
    S.ucty = await U.nactiUcty(S.vychoziRepo);
    if (G.precti(localStorage, ULOZENY, null)) ukazPrihlaseni('heslo');
    else ukazPrihlaseni(S.ucty.length ? 'ucet' : 'klic');
  }

  function ukazPrihlaseni(druh) {
    $('[data-aplikace]').hidden = true;
    $('[data-prihlaseni]').hidden = false;
    $('[data-form-lokalni]').hidden = druh !== 'lokalni';
    $('[data-form-ucet]').hidden = druh !== 'ucet';
    $('[data-form-heslo]').hidden = druh !== 'heslo';
    $('[data-form-klic]').hidden = druh !== 'klic';
    $$('[data-jsou-ucty]').forEach((el) => { el.hidden = !S.ucty.length; });
    if (druh === 'ucet') $('[data-form-ucet]').elements.jmeno.focus();
    if (druh === 'heslo') {
      const ulozeny = G.precti(localStorage, ULOZENY, {});
      $('[data-ulozene-repo]').textContent = ulozeny.repo || '';
      $('[data-form-heslo]').elements.heslo.focus();
    }
    if (druh === 'klic') {
      const f = $('[data-form-klic]');
      if (!f.elements.repo.value) f.elements.repo.value = S.vychoziRepo;
      (f.elements.repo.value ? f.elements.klic : f.elements.repo).focus();
    }
  }

  function chybaPrihlaseni(text) {
    const el = $('[data-chyba-prihlaseni]');
    el.textContent = text || '';
    el.hidden = !text;
  }

  async function sTlacitkem(form, prace) {
    const tlacitko = form.querySelector('[type="submit"]');
    const popis = tlacitko.textContent;
    tlacitko.disabled = true;
    tlacitko.textContent = 'Ověřuji…';
    chybaPrihlaseni('');
    try {
      await prace();
    } catch (e) {
      chybaPrihlaseni(e.message);
    } finally {
      tlacitko.disabled = false;
      tlacitko.textContent = popis;
    }
  }

  // Kdo se přihlásí holým klíčem (nebo klíčem uloženým v zařízení), je správce.
  const SPRAVCE_KLICEM = { jmeno: '', zobrazit: 'správce', role: 'admin', ucet: false };

  function navazPrihlaseni() {
    $('[data-form-lokalni]').addEventListener('submit', (e) => {
      e.preventDefault();
      sTlacitkem(e.target, () => prihlas(U.lokalni(), '', { jmeno: '', zobrazit: 'lokálně', role: 'admin', ucet: false }));
    });

    $$('[data-prepnout]').forEach((b) => { b.onclick = () => { chybaPrihlaseni(''); ukazPrihlaseni(b.dataset.prepnout); }; });

    const fUcet = $('[data-form-ucet]');
    fUcet.addEventListener('submit', (e) => {
      e.preventDefault();
      sTlacitkem(fUcet, async () => {
        const jmeno = fUcet.elements.jmeno.value.trim().toLowerCase();
        S.ucty = await U.nactiUcty(S.vychoziRepo); // čerstvě — heslo se mohlo právě změnit
        const ucet = S.ucty.find((u) => u.jmeno === jmeno);
        let obsah;
        try {
          if (!ucet) throw new Error();
          obsah = JSON.parse(await U.rozsifruj(ucet, fUcet.elements.heslo.value));
        } catch (chyba) {
          throw new Error('Jméno nebo heslo nesedí.');
        }
        try {
          await prihlas(U.github(obsah.repo, obsah.klic, obsah.vetev), obsah.klic, {
            jmeno: ucet.jmeno, zobrazit: ucet.zobrazit || ucet.jmeno, role: obsah.role || 'spravkyne',
            ucet: true, zmenitHeslo: !!ucet.zmenitHeslo,
          });
        } catch (chyba) {
          if (chyba.kod === 'klic' || chyba.kod === 'pravo') throw new Error(chyba.message + ' Požádejte správce, ať účtu nastaví nový klíč.');
          throw chyba;
        }
        fUcet.reset();
      });
    });

    const fHeslo = $('[data-form-heslo]');
    fHeslo.addEventListener('submit', (e) => {
      e.preventDefault();
      sTlacitkem(fHeslo, async () => {
        const ulozeny = G.precti(localStorage, ULOZENY, null);
        const klic = await U.rozsifruj(ulozeny, fHeslo.elements.heslo.value);
        await prihlas(U.github(ulozeny.repo, klic, ulozeny.vetev || S.vychoziVetev), klic, SPRAVCE_KLICEM);
        fHeslo.reset();
      });
    });
    $('[data-jiny-klic]').onclick = () => { chybaPrihlaseni(''); ukazPrihlaseni('klic'); };
    $('[data-zapomenout]').onclick = () => {
      if (!confirm('Smazat uložený klíč z tohoto prohlížeče? Příště bude potřeba vložit klíč znovu.')) return;
      G.zapis(localStorage, ULOZENY, null);
      chybaPrihlaseni('');
      ukazPrihlaseni('klic');
    };

    const fKlic = $('[data-form-klic]');
    fKlic.elements.pamatovat.addEventListener('change', () => {
      $('[data-heslo-nove]').hidden = !fKlic.elements.pamatovat.checked;
    });
    fKlic.addEventListener('submit', (e) => {
      e.preventDefault();
      sTlacitkem(fKlic, async () => {
        const repo = fKlic.elements.repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
        const klic = fKlic.elements.klic.value.trim();
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repozitář zadejte jako uzivatel/nazev.');
        if (!klic) throw new Error('Vložte přístupový klíč.');
        const pamatovat = fKlic.elements.pamatovat.checked;
        const heslo = fKlic.elements.heslo.value;
        if (pamatovat && heslo.length < 6) throw new Error('Heslo pro zařízení musí mít aspoň 6 znaků.');
        if (pamatovat && heslo !== fKlic.elements.heslo2.value) throw new Error('Hesla se neshodují.');
        const uloziste = U.github(repo, klic, S.vychoziVetev);
        await prihlas(uloziste, klic, SPRAVCE_KLICEM);
        if (pamatovat) {
          const balik = await U.zasifruj(klic, heslo);
          G.zapis(localStorage, ULOZENY, Object.assign({ repo, vetev: uloziste.vetev }, balik));
        }
        fKlic.reset();
        $('[data-heslo-nove]').hidden = true;
      });
    });
  }

  async function prihlas(uloziste, klic, uzivatel) {
    if (uloziste.over) await uloziste.over();
    const { text, verze } = await uloziste.nacti();
    S.uloziste = uloziste;
    S.klic = klic || '';
    S.uzivatel = Object.assign({}, SPRAVCE_KLICEM, uzivatel);
    ulozRelaci();
    nastavData(JSON.parse(text), verze);
    // Role jen skrývá, co správkyně nepotřebuje; klíč samotný umí v repu všechno.
    document.body.dataset.role = S.uzivatel.role;
    $('[data-prihlaseni]').hidden = true;
    $('[data-aplikace]').hidden = false;
    $('[data-rezim]').textContent = (uloziste.druh === 'lokalni' ? 'lokální složka' : uloziste.repo) +
      ' · ' + S.uzivatel.zobrazit + (S.uzivatel.ucet ? ` (${ROLE[S.uzivatel.role] || S.uzivatel.role})` : '');
    $('[data-zmenit-heslo]').hidden = !S.uzivatel.ucet;
    navazAplikaci();
    if (S.uzivatel.zmenitHeslo) otevriZmenuHesla(true);
  }

  function ulozRelaci() {
    if (S.uloziste.druh !== 'github') return;
    G.zapis(sessionStorage, RELACE, { repo: S.uloziste.repo, klic: S.klic, vetev: S.uloziste.vetev, uzivatel: S.uzivatel });
  }

  // jméno do zprávy commitu, ať je v historii vidět, kdo co změnil
  const kdo = () => (S.uzivatel && S.uzivatel.ucet ? ` (${S.uzivatel.zobrazit})` : '');

  // =========================================================================
  // data
  // =========================================================================
  function noveId() {
    let id;
    do id = G.nahodne(6); while (S.data && S.data.dila.some((d) => d.id === id));
    return id;
  }

  function normalizuj(data) {
    const n = Object.assign({
      nazev: 'Galerie', podtitul: '', autorka: '', uvod: '', oAutorce: '', portret: '',
      email: '', telefon: '', instagram: '', repo: '', vetev: '',
    }, data.nastaveni);
    n.obchod = Object.assign({ zapnuto: false, ucet: '', prijemce: '', hotove: false, doprava: [], podminky: '' }, n.obchod);
    n.vzhled = Object.assign({ styl: 'papir', rezim: 'auto', akcent: '', pismo: 'klasicke', ramy: 'zadne', velikost: 'stredni' }, n.vzhled);
    const dila = (data.dila || []).map((d) => Object.assign({
      id: G.nahodne(6), nazev: '', rok: '', technika: '', rozmer: '', serie: '', popis: '',
      stav: 'vystaveno', cena: null, tisk: null, zverejneno: true, doporucene: false, pridano: '', obrazky: [],
    }, d));
    return Object.assign({ format: 1 }, data, { nastaveni: n, dila });
  }

  function nastavData(data, verze) {
    S.data = normalizuj(data);
    S.verze = verze;
    S.nove.clear();
    S.smazat.clear();
    zapamatujStav();
    vykresliVse();
  }

  function zapamatujStav() {
    S.puvodni = JSON.stringify(S.data);
    S.puvodniDila = new Map(S.data.dila.map((d) => [d.id, JSON.stringify(d)]));
  }

  const jeZmeneno = () => S.nove.size > 0 || S.smazat.size > 0 || JSON.stringify(S.data) !== S.puvodni;
  const najdi = (id) => S.data.dila.find((d) => d.id === id);

  function vsechnyCesty(data) {
    const cesty = new Set();
    data.dila.forEach((d) => d.obrazky.forEach((o) => { cesty.add(o.velky); cesty.add(o.nahled); }));
    if (data.nastaveni.portret) cesty.add(data.nastaveni.portret);
    cesty.delete(undefined);
    cesty.delete('');
    return cesty;
  }

  function pridejSoubor(cesta, blob) {
    S.nove.set(cesta, blob);
    S.nahledy.set(cesta, URL.createObjectURL(blob));
  }

  function odeberSoubor(cesta) {
    if (!cesta) return;
    if (S.nove.has(cesta)) {
      S.nove.delete(cesta);
      URL.revokeObjectURL(S.nahledy.get(cesta));
      S.nahledy.delete(cesta);
    } else {
      S.smazat.add(cesta);
    }
  }

  // ořízne mezery kolem textů — při psaní se nechávají, ať nemizí pod kurzorem
  function ocisti(hodnota) {
    if (typeof hodnota === 'string') return hodnota.trim();
    if (Array.isArray(hodnota)) return hodnota.map(ocisti);
    if (hodnota && typeof hodnota === 'object') {
      for (const k of Object.keys(hodnota)) hodnota[k] = ocisti(hodnota[k]);
    }
    return hodnota;
  }

  // =========================================================================
  // vykreslení
  // =========================================================================
  function vykresliVse() {
    $$('[data-nazev-webu]').forEach((el) => { el.textContent = S.data.nastaveni.nazev || 'Galerie'; });
    vykresliSeznam();
    naplnNastaveni();
    naplnVzhled(true);
    aktualizujStav();
  }

  function adresa(cesta) {
    return S.nahledy.get(cesta) || G.adresaObrazku(cesta, '../');
  }

  // Čerstvě zveřejněný obrázek na GitHub Pages chvíli chybí, než se web
  // přestaví — mezitím ho vezmeme rovnou z repozitáře.
  function obrazek(cesta, alt) {
    const img = h('img', { src: adresa(cesta), alt: alt || '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      if (img.dataset.zaloha || !S.uloziste || S.uloziste.druh !== 'github') return;
      img.dataset.zaloha = '1';
      img.src = `https://raw.githubusercontent.com/${S.uloziste.repo}/${S.uloziste.vetev}/${cesta}`;
    });
    return img;
  }

  function vykresliSeznam() {
    const seznam = $('[data-seznam]');
    seznam.replaceChildren(...S.data.dila.map(karta));
    $('[data-ukazky]').hidden = !S.data.dila.some((d) => d.ukazka);
    $('[data-pocet-del]').textContent = S.data.dila.length || '';
    $('[data-napoveda-poradi]').hidden = S.data.dila.length < 2;
    const serie = [...new Set(S.data.dila.map((d) => d.serie && d.serie.trim()).filter(Boolean))];
    $('#serie').replaceChildren(...serie.map((s) => h('option', { value: s })));
  }

  function karta(d) {
    const o = d.obrazky[0];
    const puvodni = S.puvodniDila.get(d.id);
    const zmena = !puvodni ? 'nové' : puvodni !== JSON.stringify(d) ? 'upravené' : '';
    const obchod = S.data.nastaveni.obchod.zapnuto;
    const li = h('li', {
      class: 'karta' + (d.zverejneno === false ? ' skryte' : ''), draggable: 'true', dataset: { id: d.id },
    },
    h('div', {
      class: 'karta-otevrit', role: 'button', tabindex: '0', 'aria-label': 'Upravit: ' + (d.nazev || 'bez názvu'),
      onclick: () => otevriEditor(d.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); otevriEditor(d.id); } },
    },
    h('span', { class: 'karta-obraz' }, o ? obrazek(o.nahled || o.velky, '') : h('span', { class: 'bez-obrazu' }, 'bez fotky')),
    h('span', { class: 'karta-text' },
      h('strong', {}, d.nazev || 'Bez názvu'),
      h('small', {}, [d.rok, d.serie].filter(Boolean).join(' · ') || ' ')),
    h('span', { class: 'karta-stitky' },
      zmena && h('span', { class: 'st zmena' }, zmena),
      d.ukazka && h('span', { class: 'st ukazka' }, 'ukázka'),
      d.zverejneno === false && h('span', { class: 'st skryte' }, 'skryté'),
      d.doporucene && h('span', { class: 'st doporucene' }, '★ úvod'),
      obchod && d.stav !== 'vystaveno' && h('span', { class: 'st ' + d.stav }, G.STAVY[d.stav] + (d.stav === 'prodej' && d.cena ? ' · ' + cena(d.cena) : '')),
      obchod && d.tisk && d.tisk.cena > 0 && h('span', { class: 'st tisk' }, 'tisk ' + cena(d.tisk.cena)))));

    // přetahování pořadí
    li.addEventListener('dragstart', (e) => {
      S.tazene = d.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', d.id);
      li.classList.add('tazena');
    });
    li.addEventListener('dragend', () => {
      S.tazene = null;
      $$('.karta').forEach((k) => k.classList.remove('tazena', 'cil-pred', 'cil-za'));
    });
    li.addEventListener('dragover', (e) => {
      if (!S.tazene || S.tazene === d.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const za = e.clientX > r.left + r.width / 2;
      li.classList.toggle('cil-za', za);
      li.classList.toggle('cil-pred', !za);
    });
    li.addEventListener('dragleave', () => li.classList.remove('cil-pred', 'cil-za'));
    li.addEventListener('drop', (e) => {
      if (!S.tazene) return;
      e.preventDefault();
      e.stopPropagation();
      presun(S.tazene, d.id, li.classList.contains('cil-za'));
    });
    return li;
  }

  function presun(id, cilId, za) {
    const dila = S.data.dila;
    const dilo = najdi(id);
    if (!dilo || id === cilId) return;
    dila.splice(dila.indexOf(dilo), 1);
    const kam = dila.findIndex((x) => x.id === cilId);
    dila.splice(kam + (za ? 1 : 0), 0, dilo);
    vykresliSeznam();
    aktualizujStav();
  }

  function aktualizujStav(zprava) {
    const zmeneno = jeZmeneno();
    $('[data-zverejnit]').disabled = !zmeneno;
    $('[data-zahodit]').hidden = !zmeneno;
    const stav = $('[data-stav-ulozeni]');
    if (zprava !== undefined) stav.dataset.zprava = zprava;
    stav.textContent = zmeneno ? 'Neuložené změny' : (stav.dataset.zprava || 'Všechno uloženo');
    stav.classList.toggle('neulozeno', zmeneno);
  }

  // =========================================================================
  // editor díla
  // =========================================================================
  function otevriEditor(id) {
    const d = najdi(id);
    if (!d) return;
    S.editovane = id;
    const f = formEditor.elements;
    f.nazev.value = d.nazev || '';
    f.rok.value = d.rok || '';
    f.technika.value = d.technika || '';
    f.rozmer.value = d.rozmer || '';
    f.serie.value = d.serie || '';
    f.popis.value = d.popis || '';
    (formEditor.querySelector(`[name="stav"][value="${d.stav}"]`) || formEditor.querySelector('[name="stav"]')).checked = true;
    f.cena.value = d.cena != null ? d.cena : '';
    f.tiskZapnuto.checked = !!d.tisk;
    f.tiskCena.value = d.tisk && d.tisk.cena != null ? d.tisk.cena : '';
    f.tiskPopis.value = (d.tisk && d.tisk.popis) || '';
    f.zverejneno.checked = d.zverejneno !== false;
    f.doporucene.checked = !!d.doporucene;
    $('#editor-nadpis').textContent = d.nazev || 'Nové dílo';
    vykresliObrazkyEditoru(d);
    aktualizujEditor(d);
    if (!editor.open) editor.showModal();
    if (!d.nazev || d.nazev === 'Nové dílo') { f.nazev.focus(); f.nazev.select(); }
  }

  const cislo = (v) => (String(v).trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0));

  function zapisEditor() {
    const d = najdi(S.editovane);
    if (!d) return;
    const f = formEditor.elements;
    d.nazev = f.nazev.value;
    d.rok = f.rok.value;
    d.technika = f.technika.value;
    d.rozmer = f.rozmer.value;
    d.serie = f.serie.value;
    d.popis = f.popis.value;
    d.stav = (formEditor.querySelector('[name="stav"]:checked') || {}).value || 'vystaveno';
    d.cena = cislo(f.cena.value);
    d.tisk = f.tiskZapnuto.checked ? { cena: cislo(f.tiskCena.value), popis: f.tiskPopis.value } : null;
    d.zverejneno = f.zverejneno.checked;
    d.doporucene = f.doporucene.checked;
    $('#editor-nadpis').textContent = d.nazev.trim() || 'Nové dílo';
    aktualizujEditor(d);
    vykresliSeznam();
    aktualizujStav();
  }

  function aktualizujEditor(d) {
    const obchod = S.data.nastaveni.obchod.zapnuto;
    $('[data-obchod-vypnuty]').hidden = obchod;
    $('[data-tisk-pole]').hidden = !formEditor.elements.tiskZapnuto.checked;
    const cenaPole = formEditor.elements.cena;
    cenaPole.closest('label').classList.toggle('ztlumene', d.stav === 'vystaveno');
    const i = S.data.dila.indexOf(d);
    $('[data-posun="-1"]').disabled = i <= 0;
    $('[data-posun="1"]').disabled = i >= S.data.dila.length - 1;
  }

  function vykresliObrazkyEditoru(d) {
    $('[data-obrazky]').replaceChildren(...d.obrazky.map((o, i) => h('li', { class: i === 0 ? 'hlavni' : '' },
      obrazek(o.nahled || o.velky, ''),
      i === 0 && d.obrazky.length > 1 && h('span', { class: 'hlavni-stitek' }, 'hlavní'),
      h('span', { class: 'obrazek-akce' },
        i > 0 && h('button', {
          type: 'button', title: 'Udělat hlavní fotkou',
          onclick: () => { d.obrazky.unshift(d.obrazky.splice(i, 1)[0]); vykresliObrazkyEditoru(d); vykresliSeznam(); aktualizujStav(); },
        }, '★'),
        h('button', {
          type: 'button', title: 'Odebrat fotku',
          onclick: () => {
            if (d.obrazky.length === 1 && !confirm('Dílo pak nebude mít žádnou fotku a na webu se neukáže. Odebrat?')) return;
            const [pryc] = d.obrazky.splice(i, 1);
            odeberSoubor(pryc.velky);
            if (pryc.nahled !== pryc.velky) odeberSoubor(pryc.nahled);
            vykresliObrazkyEditoru(d);
            vykresliSeznam();
            aktualizujStav();
          },
        }, '×')))));
  }

  function smazDilo(id) {
    const d = najdi(id);
    if (!d || !confirm(`Smazat „${d.nazev || 'bez názvu'}“ i s fotkami? Z webu zmizí po zveřejnění.`)) return;
    S.data.dila.splice(S.data.dila.indexOf(d), 1);
    d.obrazky.forEach((o) => { odeberSoubor(o.velky); if (o.nahled !== o.velky) odeberSoubor(o.nahled); });
    if (editor.open) editor.close();
    vykresliSeznam();
    aktualizujStav();
  }

  // =========================================================================
  // fotky
  // =========================================================================
  const naBlob = (platno, typ, kvalita) => new Promise((ok) => platno.toBlob(ok, typ, kvalita));

  async function nactiObrazek(soubor) {
    const url = URL.createObjectURL(soubor);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      const heic = /\.hei[cf]$/i.test(soubor.name) || /hei[cf]/i.test(soubor.type);
      throw new Error(heic
        ? 'formát HEIC tenhle prohlížeč neumí — v telefonu ho uložte jako JPG, nebo nahrávejte přímo z telefonu'
        : 'tohle nevypadá jako obrázek, který prohlížeč umí otevřít');
    }
    if (!img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); throw new Error('obrázek nemá rozměry'); }
    return { img, uvolni: () => URL.revokeObjectURL(url) };
  }

  // Zmenšuje po polovinách — z dvanáctimegapixelové fotky je pak náhled
  // ostřejší, než kdyby se zmenšil jedním krokem.
  async function zmensi(img, max) {
    const pomer = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const sirka = Math.max(1, Math.round(img.naturalWidth * pomer));
    const vyska = Math.max(1, Math.round(img.naturalHeight * pomer));
    let zdroj = img;
    let zs = img.naturalWidth;
    let zv = img.naturalHeight;
    while (zs / 2 > sirka * 1.1) {
      const mezi = document.createElement('canvas');
      mezi.width = Math.round(zs / 2);
      mezi.height = Math.round(zv / 2);
      const c = mezi.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(zdroj, 0, 0, mezi.width, mezi.height);
      zdroj = mezi; zs = mezi.width; zv = mezi.height;
    }
    const platno = document.createElement('canvas');
    platno.width = sirka;
    platno.height = vyska;
    const ctx = platno.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sirka, vyska);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(zdroj, 0, 0, sirka, vyska);
    let blob = await naBlob(platno, 'image/webp', 0.86);
    let pripona = 'webp';
    if (!blob || blob.type !== 'image/webp') { // Safari WebP neumí uložit
      blob = await naBlob(platno, 'image/jpeg', 0.88);
      pripona = 'jpg';
    }
    return { blob, pripona, sirka, vyska };
  }

  async function pripravObrazek(soubor, nazev) {
    const { img, uvolni } = await nactiObrazek(soubor);
    try {
      const zaklad = `${G.slug(nazev)}-${G.nahodne(4)}`;
      const velky = await zmensi(img, VELKY);
      const nahled = await zmensi(img, NAHLED);
      const cestaV = `obrazy/velke/${zaklad}.${velky.pripona}`;
      const cestaN = `obrazy/nahledy/${zaklad}.${nahled.pripona}`;
      pridejSoubor(cestaV, velky.blob);
      pridejSoubor(cestaN, nahled.blob);
      return { velky: cestaV, nahled: cestaN, sirka: velky.sirka, vyska: velky.vyska };
    } finally {
      uvolni();
    }
  }

  function nazevZeSouboru(jmeno) {
    const zaklad = jmeno.replace(/\.[^.]+$/, '');
    if (/^(img|dsc|dscn|pxl|p\d|photo|foto|image|whatsapp|screenshot|snimek|20\d\d)[\s_-]?/i.test(zaklad) || /^\d+$/.test(zaklad)) return 'Nové dílo';
    const hezky = zaklad.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return hezky ? hezky[0].toUpperCase() + hezky.slice(1) : 'Nové dílo';
  }

  const jeObrazek = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i.test(f.name);
  const dnes = () => new Date().toISOString().slice(0, 10);

  async function pridejDila(soubory) {
    const fotky = [...soubory].filter(jeObrazek);
    if (!fotky.length) { oznam('Tohle nejsou obrázky.', true); return; }
    const nova = [];
    const chyby = [];
    ukazPrubeh('Zpracovávám fotky…');
    for (const [i, soubor] of fotky.entries()) {
      prubeh(i, fotky.length, `Zmenšuji fotku ${i + 1} z ${fotky.length}…`);
      try {
        const nazev = nazevZeSouboru(soubor.name);
        const o = await pripravObrazek(soubor, nazev);
        nova.push({
          id: noveId(), nazev, rok: String(new Date().getFullYear()), technika: '', rozmer: '', serie: '', popis: '',
          stav: 'vystaveno', cena: null, tisk: null, zverejneno: true, doporucene: false, pridano: dnes(), obrazky: [o],
        });
      } catch (e) {
        chyby.push(`${soubor.name}: ${e.message}`);
      }
    }
    skryjPrubeh();
    S.data.dila.unshift(...nova);
    vybratZalozku('dila');
    vykresliSeznam();
    aktualizujStav();
    if (chyby.length) oznam('Některé fotky nešly přidat — ' + chyby.join('; '), true);
    else if (nova.length > 1) oznam(`${nova.length < 5 ? `Přidána ${nova.length} díla` : `Přidáno ${nova.length} děl`}. Doplňte názvy a zveřejněte.`);
    if (nova.length === 1) otevriEditor(nova[0].id);
  }

  async function pridejFotky(d, soubory) {
    const fotky = [...soubory].filter(jeObrazek);
    if (!fotky.length) return;
    ukazPrubeh('Zpracovávám fotky…');
    try {
      for (const [i, soubor] of fotky.entries()) {
        prubeh(i, fotky.length, `Zmenšuji fotku ${i + 1} z ${fotky.length}…`);
        d.obrazky.push(await pripravObrazek(soubor, d.nazev || 'obraz'));
      }
    } catch (e) {
      oznam('Fotku nešlo přidat — ' + e.message, true);
    } finally {
      skryjPrubeh();
    }
    vykresliObrazkyEditoru(d);
    vykresliSeznam();
    aktualizujStav();
  }

  // =========================================================================
  // nastavení
  // =========================================================================
  const ziskej = (obj, cesta) => cesta.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function nastav(obj, cesta, hodnota) {
    const klice = cesta.split('.');
    const posledni = klice.pop();
    klice.reduce((o, k) => o[k], obj)[posledni] = hodnota;
  }

  function naplnNastaveni() {
    const n = S.data.nastaveni;
    for (const el of formNastaveni.elements) {
      if (!el.name) continue;
      const v = ziskej(n, el.name);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v == null ? '' : v;
    }
    vykresliDopravu();
    vykresliPortret();
    kontrolaObchodu();
  }

  function vykresliDopravu() {
    const doprava = S.data.nastaveni.obchod.doprava;
    $('[data-doprava]').replaceChildren(...doprava.map((m, i) => h('li', { class: 'doprava-radek' },
      h('input', { 'aria-label': 'Název', placeholder: 'Osobní převzetí', value: m.nazev || '', oninput: (e) => { m.nazev = e.target.value; aktualizujStav(); } }),
      h('label', { class: 'kratke' }, h('input', {
        type: 'number', min: '0', step: '1', 'aria-label': 'Cena v Kč', value: m.cena != null ? m.cena : '',
        oninput: (e) => { m.cena = cislo(e.target.value) || 0; aktualizujStav(); },
      }), ' Kč'),
      h('label', { class: 'zaskrt' }, h('input', {
        type: 'checkbox', checked: !!m.adresa, onchange: (e) => { m.adresa = e.target.checked; aktualizujStav(); },
      }), ' chce adresu'),
      h('button', {
        class: 'odkaz', type: 'button', 'aria-label': 'Odebrat způsob',
        onclick: () => { doprava.splice(i, 1); vykresliDopravu(); aktualizujStav(); },
      }, 'odebrat'))));
  }

  function vykresliPortret() {
    const cesta = S.data.nastaveni.portret;
    $('[data-portret-nahled]').replaceChildren(cesta ? obrazek(cesta, 'Portrét') : h('span', {}, 'bez fotky'));
    $('[data-portret-smazat]').hidden = !cesta;
  }

  function kontrolaObchodu() {
    const o = S.data.nastaveni.obchod;
    $('[data-obchod-pole]').classList.toggle('ztlumene', !o.zapnuto);
    const box = $('[data-ucet-kontrola]');
    const zpravy = [];
    if (o.zapnuto && !String(S.data.nastaveni.email).trim()) {
      zpravy.push(h('p', { class: 'varovani' }, 'Vyplňte e-mail v části O autorce — jinak nebudou objednávky kam chodit.'));
    }
    if (String(o.ucet).trim()) {
      const { iban, chyba } = G.qr.ucetNaIban(o.ucet);
      if (chyba) {
        zpravy.push(h('p', { class: 'varovani' }, chyba));
      } else {
        const ukazka = h('div', { class: 'qr-zkouska', hidden: true });
        zpravy.push(h('p', { class: 'v-poradku' }, `✓ IBAN ${iban.replace(/(.{4})/g, '$1 ').trim()} `,
          h('button', {
            class: 'odkaz', type: 'button',
            onclick: () => {
              ukazka.replaceChildren(G.qr.svg(G.qr.platba({ iban, castka: 1, zprava: 'Zkouska QR platby', prijemce: o.prijemce }), 'Zkušební QR'),
                h('span', {}, 'Zkušební platba 1 Kč. Naskenujte ji v bance a zkontrolujte, že sedí účet a jméno — ale neodesílejte.'));
              ukazka.hidden = !ukazka.hidden;
            },
          }, 'zkušební QR kód')), ukazka);
      }
    } else if (o.zapnuto && !o.hotove) {
      zpravy.push(h('p', { class: 'napoveda' }, 'Bez čísla účtu se u objednávky neukáže QR platba — platbu pak domluvíte e-mailem.'));
    }
    box.replaceChildren(...zpravy);
  }

  async function nahrajPortret(soubor) {
    if (!soubor) return;
    ukazPrubeh('Zpracovávám portrét…');
    try {
      const { img, uvolni } = await nactiObrazek(soubor);
      try {
        const vysledek = await zmensi(img, PORTRET);
        const cesta = `obrazy/portret-${G.nahodne(4)}.${vysledek.pripona}`;
        odeberSoubor(S.data.nastaveni.portret);
        pridejSoubor(cesta, vysledek.blob);
        S.data.nastaveni.portret = cesta;
      } finally {
        uvolni();
      }
    } catch (e) {
      oznam('Portrét nešel nahrát — ' + e.message, true);
    } finally {
      skryjPrubeh();
    }
    vykresliPortret();
    aktualizujStav();
  }

  // =========================================================================
  // zveřejnění
  // =========================================================================
  const naBase64 = (blob) => new Promise((ok, chyba) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => chyba(r.error);
    r.readAsDataURL(blob);
  });

  function popisZmen(stara, nova) {
    const stare = new Map(stara.dila.map((d) => [d.id, JSON.stringify(d)]));
    const noveId = new Set(nova.dila.map((d) => d.id));
    const pridano = nova.dila.filter((d) => !stare.has(d.id)).length;
    const upraveno = nova.dila.filter((d) => stare.has(d.id) && stare.get(d.id) !== JSON.stringify(d)).length;
    const smazano = stara.dila.filter((d) => !noveId.has(d.id)).length;
    const poradi = stara.dila.map((d) => d.id).filter((id) => noveId.has(id)).join() !==
      nova.dila.map((d) => d.id).filter((id) => stare.has(id)).join();
    const bezVzhledu = (n) => JSON.stringify(Object.assign({}, n, { vzhled: null }));
    const nastaveni = bezVzhledu(stara.nastaveni) !== bezVzhledu(nova.nastaveni);
    const vzhled = JSON.stringify(stara.nastaveni.vzhled) !== JSON.stringify(nova.nastaveni.vzhled);
    const casti = [
      pridano && `přidáno ${pridano}`, upraveno && `upraveno ${upraveno}`, smazano && `smazáno ${smazano}`,
      poradi && 'pořadí', nastaveni && 'nastavení', vzhled && 'vzhled',
    ].filter(Boolean);
    return `Správa${kdo()}: ` + (casti.join(', ') || 'drobné úpravy');
  }

  // titulek a popis v index.html, ať náhled odkazu (Messenger, WhatsApp…) ukáže správný název
  function prepisHlavicku(html, n) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const titulek = esc(n.nazev || 'Galerie');
    const popis = esc(n.podtitul || n.nazev || '');
    return html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${titulek}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, (_, a, b) => a + popis + b)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, (_, a, b) => a + titulek + b)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, (_, a, b) => a + popis + b);
  }

  async function zverejni() {
    if (!jeZmeneno() || !$('[data-ukladani]').hidden) return;
    if (editor.open) editor.close();
    ocisti(S.data);
    const stara = JSON.parse(S.puvodni);
    const zprava = popisZmen(stara, S.data);
    const predchoziRazitko = S.data.upraveno;
    S.data.upraveno = new Date().toISOString();
    const pouzite = vsechnyCesty(S.data);

    ukazPrubeh('Připravuji…');
    try {
      const soubory = [];
      for (const [cesta, blob] of S.nove) {
        if (pouzite.has(cesta)) soubory.push({ cesta, base64: await naBase64(blob) });
      }
      soubory.push({ cesta: U.DATA, text: JSON.stringify(S.data, null, 2) + '\n' });
      if (stara.nastaveni.nazev !== S.data.nastaveni.nazev || stara.nastaveni.podtitul !== S.data.nastaveni.podtitul) {
        try {
          const html = await S.uloziste.nactiSoubor('index.html');
          const novy = prepisHlavicku(html, S.data.nastaveni);
          if (novy !== html) soubory.push({ cesta: 'index.html', text: novy });
        } catch (e) { /* titulek se doplní příště; web funguje i tak */ }
      }
      const smazat = [...S.smazat].filter((c) => !pouzite.has(c));

      const vysledek = await S.uloziste.uloz({ soubory, smazat, zprava, verze: S.verze }, prubeh);
      S.verze = vysledek.verze;
      S.nove.clear();
      S.smazat.clear();
      zapamatujStav();
      skryjPrubeh();
      vykresliVse();
      if (S.uloziste.druh === 'github') hlidejNasazeni(S.data.upraveno);
      else { aktualizujStav('Uloženo do složky'); oznam('Uloženo do složky. Na web se to dostane s dalším nahráním do repozitáře.'); }
    } catch (e) {
      S.data.upraveno = predchoziRazitko;
      skryjPrubeh();
      aktualizujStav();
      if (e.kod === 'konflikt') {
        if (confirm(e.message + '\n\nNačíst aktuální verzi teď? Neuložené úpravy se zahodí.')) nactiZnovu();
      } else if (e.kod === 'klic') {
        oznam(e.message + ' Přihlaste se znovu — neuložené úpravy zůstávají otevřené v téhle záložce.', true);
        G.zapis(sessionStorage, RELACE, null);
      } else {
        oznam('Nepodařilo se uložit: ' + e.message, true);
      }
    }
  }

  async function nactiZnovu() {
    ukazPrubeh('Načítám aktuální verzi…');
    try {
      const { text, verze } = await S.uloziste.nacti();
      S.nahledy.forEach((url) => URL.revokeObjectURL(url));
      S.nahledy.clear();
      nastavData(JSON.parse(text), verze);
    } catch (e) {
      oznam(e.message, true);
    } finally {
      skryjPrubeh();
    }
  }

  // GitHub Pages web přestaví zhruba do minuty. Ověřujeme to přímo na webu:
  // jakmile veřejný galerie.json nese naše razítko „upraveno“, je hotovo.
  function hlidejNasazeni(razitko) {
    clearTimeout(S.hlidani);
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      aktualizujStav('Zapsáno do repozitáře');
      return;
    }
    const zacatek = Date.now();
    aktualizujStav('Zapsáno — web se přestavuje…');
    $('[data-stav-ulozeni]').classList.add('prace');
    const zkus = async () => {
      try {
        const odp = await fetch(new URL('../data/galerie.json', location.href).href + '?v=' + Date.now(), { cache: 'no-store' });
        const verejna = odp.ok ? await odp.json() : {};
        if (verejna.upraveno === razitko) {
          $('[data-stav-ulozeni]').classList.remove('prace');
          aktualizujStav('Web je aktuální ✓');
          oznam('Hotovo — změny jsou na webu.');
          return;
        }
      } catch (e) { /* zkusíme znovu */ }
      if (Date.now() - zacatek > 5 * 60 * 1000) {
        $('[data-stav-ulozeni]').classList.remove('prace');
        aktualizujStav('Zapsáno, web se zatím nepřestavěl');
        oznam('Změny jsou uložené, ale web se ještě nepřestavěl. Podívejte se do repozitáře na záložku Actions.', true);
        return;
      }
      S.hlidani = setTimeout(zkus, 6000);
    };
    S.hlidani = setTimeout(zkus, 8000);
  }

  // =========================================================================
  // průběh a oznámení
  // =========================================================================
  function ukazPrubeh(text) {
    $('[data-ukladani]').hidden = false;
    prubeh(0, 1, text);
  }
  function prubeh(hotovo, celkem, text) {
    if (text) $('[data-ukladani-text]').textContent = text;
    $('[data-ukladani-pruh]').style.width = Math.round((hotovo / Math.max(1, celkem)) * 100) + '%';
  }
  function skryjPrubeh() {
    $('[data-ukladani]').hidden = true;
  }

  let casovac;
  function oznam(text, chyba) {
    const el = $('[data-oznameni]');
    el.textContent = text;
    el.classList.toggle('chyba', !!chyba);
    el.hidden = false;
    clearTimeout(casovac);
    casovac = setTimeout(() => { el.hidden = true; }, chyba ? 9000 : 3500);
  }

  function vybratZalozku(nazev) {
    $$('[data-zalozka]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.zalozka === nazev)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== nazev; });
    if (nazev === 'vzhled') naplnVzhled(true);
    if (nazev === 'ucty') vykresliUcty();
  }

  // =========================================================================
  // vzhled
  // =========================================================================
  function naplnVzhled(vcetneNahledu) {
    const n = S.data.nastaveni;
    const v = n.vzhled;
    const f = $('[data-vzhled]');
    if (!$('[data-styly]').children.length) {
      $('[data-styly]').replaceChildren(...Object.entries(G.VZHLEDY).map(([kod, s]) => {
        const sv = s.svetly || s.tmavy;
        return h('label', { class: 'styl-karta' },
          h('input', { type: 'radio', name: 'styl', value: kod }),
          h('span', { class: 'vzorek', 'aria-hidden': 'true' },
            [sv.papir, sv.inkoust, sv.akcent, s.tmavy.papir].map((b) => h('span', { styl: { background: b } }))),
          h('strong', {}, s.nazev),
          h('small', {}, s.popis));
      }));
    }
    $('[data-pisma]').replaceChildren(...Object.entries(G.PISMA).map(([kod, p]) => h('label', { class: 'pismo-volba' },
      h('input', { type: 'radio', name: 'pismo', value: kod }),
      h('span', { class: 'ukazka-pisma', styl: { 'font-family': p.rodina, 'font-weight': String(p.vaha) } }, n.nazev || 'Malá galerie'),
      h('small', {}, p.nazev))));
    for (const nazev of ['styl', 'rezim', 'pismo', 'ramy', 'velikost']) {
      const volba = f.querySelector(`[name="${nazev}"][value="${v[nazev]}"]`);
      if (volba) volba.checked = true;
    }
    const jenTmavy = !!(G.VZHLEDY[v.styl] || {}).jenTmavy;
    $('[data-jen-tmavy]').hidden = !jenTmavy;
    $$('[name="rezim"]', f).forEach((r) => { r.disabled = jenTmavy; });
    const akcentStylu = G.tokenyVzhledu(Object.assign({}, v, { akcent: '' }), false).tokeny.akcent;
    f.elements.akcent.value = v.akcent || akcentStylu;
    $('[data-akcent-stav]').textContent = v.akcent ? 'vlastní barva' : 'barva stylu';
    $('[data-akcent-vychozi]').hidden = !v.akcent;
    const nahledRezim = document.querySelector(`[name="nahledRezim"][value="${S.nahledTmavy ? 'tmavy' : 'svetly'}"]`);
    nahledRezim.checked = true;
    $$('[name="nahledRezim"]').forEach((r) => { r.disabled = jenTmavy; });
    if (vcetneNahledu) vykresliNahledVzhledu();
    else G.pouzijVzhled($('[data-nahled-vzhledu]'), v, S.nahledTmavy);
  }

  // Zmenšená stránka galerie se skutečnými obrázky a texty
  function vykresliNahledVzhledu() {
    const n = S.data.nastaveni;
    const el = $('[data-nahled-vzhledu]');
    G.pouzijVzhled(el, n.vzhled, S.nahledTmavy);
    const dila = S.data.dila.filter((d) => d.obrazky.length && d.zverejneno !== false);
    const hlavni = dila.find((d) => d.doporucene) || dila[0];
    const prodej = n.obchod.zapnuto && dila.find((d) => d.stav === 'prodej' && d.cena);
    el.replaceChildren(
      h('div', { class: 'nv-lista' },
        h('span', { class: 'nv-znak' }, n.nazev || 'Galerie'),
        h('span', { class: 'nv-menu' }, 'GALERIE · O AUTORCE · KONTAKT')),
      h('div', { class: 'nv-uvod' },
        h('div', {},
          n.autorka && h('p', { class: 'nv-nad' }, n.autorka),
          h('p', { class: 'nv-h1' }, n.nazev || 'Galerie'),
          n.podtitul && h('p', { class: 'nv-pod' }, n.podtitul),
          h('div', { class: 'nv-tlacitka' },
            h('span', { class: 'nv-tl' }, 'Prohlédnout obrazy'),
            h('span', { class: 'nv-tl plne' }, n.obchod.zapnuto ? 'Vložit do košíku' : 'Tlačítko'),
            h('span', { class: 'nv-odkaz' }, 'odkaz'))),
        hlavni && h('div', { class: 'nv-ram' }, obrazek(hlavni.obrazky[0].nahled || hlavni.obrazky[0].velky, ''))),
      h('div', { class: 'nv-mrizka' }, dila.slice(0, 8).map((d) => {
        const o = d.obrazky[0];
        const p = o.sirka && o.vyska ? o.sirka / o.vyska : 1;
        return h('div', { class: 'nv-dlazdice', styl: { '--p': p.toFixed(3) } },
          obrazek(o.nahled || o.velky, ''),
          d === prodej && h('span', { class: 'nv-stitek' }, cena(d.cena)));
      })),
    );
  }

  function zapisVzhled(e) {
    const el = e.target;
    const v = S.data.nastaveni.vzhled;
    if (['styl', 'rezim', 'pismo', 'ramy', 'velikost'].includes(el.name)) {
      if (!el.checked) return;
      v[el.name] = el.value;
    } else if (el.name === 'akcent') {
      v.akcent = el.value;
    } else {
      return;
    }
    naplnVzhled(false);
    aktualizujStav();
  }

  // =========================================================================
  // účty
  // =========================================================================
  const dnesniDatum = () => new Date().toISOString().slice(0, 10);
  const hezkeDatum = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('cs-CZ') : '');

  async function nactiUctyRepo() {
    try {
      const data = JSON.parse(await S.uloziste.nactiSoubor(U.UCTY));
      return Object.assign({ format: 1, ucty: [] }, data);
    } catch (e) {
      if (e.kod === 'nenalezeno') return { format: 1, ucty: [] };
      throw e;
    }
  }

  // Účty se ukládají hned, mimo tlačítko Zveřejnit — týkají se přístupu, ne obsahu webu.
  async function zapisUcty(zmena, zprava) {
    ukazPrubeh('Ukládám účty…');
    try {
      const data = await nactiUctyRepo();
      zmena(data.ucty);
      await S.uloziste.uloz({ soubory: [{ cesta: U.UCTY, text: JSON.stringify(data, null, 2) + '\n' }], smazat: [], zprava, verze: null }, prubeh);
      return data.ucty;
    } finally {
      skryjPrubeh();
    }
  }

  async function vykresliUcty() {
    const seznam = $('[data-ucty-seznam]');
    $('[data-muj-klic]').hidden = !S.klic;
    let ucty;
    try {
      ucty = (await nactiUctyRepo()).ucty;
    } catch (e) {
      seznam.replaceChildren(h('li', { class: 'chyba' }, 'Účty se nepodařilo načíst: ' + e.message));
      return;
    }
    $('[data-ucty-prazdne]').hidden = ucty.length > 0;
    seznam.replaceChildren(...ucty.map((u) => h('li', { class: 'ucet' },
      h('span', { class: 'ucet-avatar', 'aria-hidden': 'true' }, (u.zobrazit || u.jmeno).slice(0, 1).toUpperCase()),
      h('span', { class: 'ucet-text' },
        h('strong', {}, u.zobrazit || u.jmeno),
        h('small', {}, `přihlašovací jméno ${u.jmeno}` + (u.zmeneno ? ` · změněno ${hezkeDatum(u.zmeneno)}` : ''))),
      h('span', { class: 'karta-stitky' },
        h('span', { class: 'st ' + u.role }, ROLE[u.role] || u.role),
        u.zmenitHeslo && h('span', { class: 'st zmena' }, 'čeká na vlastní heslo'),
        S.uzivatel.jmeno === u.jmeno && h('span', { class: 'st ja' }, 'vy')),
      h('span', { class: 'ucet-akce' },
        h('button', { class: 'tl male', type: 'button', onclick: () => upravUcet(u) }, 'Nové heslo / klíč'),
        h('button', { class: 'tl male nebezpecne', type: 'button', onclick: () => smazUcet(u) }, 'Smazat')))));
  }

  function upravUcet(u) {
    const f = $('[data-ucet-formular]');
    f.reset();
    S.upravovanyUcet = u.jmeno;
    f.elements.jmeno.value = u.jmeno;
    f.elements.jmeno.readOnly = true;
    f.elements.zobrazit.value = u.zobrazit || '';
    (f.querySelector(`[name="role"][value="${u.role}"]`) || {}).checked = true;
    $('[data-ucet-nadpis]').textContent = `Nové heslo nebo klíč — ${u.zobrazit || u.jmeno}`;
    $('[data-ucet-ulozit]').textContent = 'Uložit';
    $('[data-ucet-zrusit]').hidden = false;
    $('[data-predani]').hidden = true;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.elements.heslo.focus();
  }

  function zrusUpravuUctu() {
    const f = $('[data-ucet-formular]');
    f.reset();
    S.upravovanyUcet = null;
    f.elements.jmeno.readOnly = false;
    $('[data-ucet-nadpis]').textContent = 'Nový účet';
    $('[data-ucet-ulozit]').textContent = 'Vytvořit účet';
    $('[data-ucet-zrusit]').hidden = true;
    $('[data-ucet-chyba]').hidden = true;
  }

  async function ulozUcet(e) {
    e.preventDefault();
    const f = e.target;
    const pole = f.elements;
    const chyba = $('[data-ucet-chyba]');
    const tlacitko = $('[data-ucet-ulozit]');
    chyba.hidden = true;
    tlacitko.disabled = true;
    try {
      const jmeno = pole.jmeno.value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{1,29}$/.test(jmeno)) throw new Error('Přihlašovací jméno: 2–30 znaků, malá písmena bez diakritiky, číslice, tečka, pomlčka.');
      const heslo = pole.heslo.value;
      if (heslo.length < MIN_HESLO) throw new Error(`Heslo musí mít aspoň ${MIN_HESLO} znaků.`);
      const role = (f.querySelector('[name="role"]:checked') || {}).value || 'spravkyne';
      const zdroj = (f.querySelector('[name="zdroj"]:checked') || {}).value;
      if (!S.upravovanyUcet && (await nactiUctyRepo()).ucty.some((u) => u.jmeno === jmeno)) {
        throw new Error('Účet s tímhle jménem už existuje.');
      }

      let obsah;
      if (zdroj === 'muj') {
        if (!S.klic) throw new Error('Nejste přihlášený klíčem — vložte pro účet nový klíč.');
        obsah = { klic: S.klic, repo: S.uloziste.repo, vetev: S.uloziste.vetev };
      } else {
        const klic = pole.klic.value.trim();
        if (!klic) throw new Error('Vložte přístupový klíč pro tenhle účet.');
        const repo = S.uloziste.repo || S.data.nastaveni.repo.trim();
        if (!repo) throw new Error('Nejdřív vyplňte v Nastavení → Pokročilé repozitář.');
        const gh = U.github(repo, klic, S.uloziste.vetev || S.data.nastaveni.vetev.trim());
        ukazPrubeh('Ověřuji klíč na GitHubu…');
        try { await gh.over(); } finally { skryjPrubeh(); }
        obsah = { klic, repo, vetev: gh.vetev };
      }
      obsah.role = role;
      const balik = await U.zasifruj(JSON.stringify(obsah), heslo);
      const zaznam = Object.assign({
        jmeno, zobrazit: pole.zobrazit.value.trim() || jmeno, role, zmenitHeslo: true, zmeneno: dnesniDatum(),
      }, balik);
      const novy = !S.upravovanyUcet;
      await zapisUcty((ucty) => {
        const i = ucty.findIndex((u) => u.jmeno === jmeno);
        if (i >= 0) ucty[i] = zaznam;
        else ucty.push(zaznam);
      }, `Správa${kdo()}: ${novy ? 'nový účet' : 'nové heslo pro účet'} ${jmeno}`);

      $('[data-predani-text]').textContent = [
        `Adresa:         ${new URL('.', location.href).href}`,
        `Jméno:          ${jmeno}`,
        `Dočasné heslo:  ${heslo}`,
        '',
        'Po prvním přihlášení si nastavte vlastní heslo.',
      ].join('\n');
      $('[data-predani]').hidden = false;
      zrusUpravuUctu();
      await vykresliUcty();
      oznam(novy ? 'Účet je vytvořený.' : 'Účet má nové heslo.');
    } catch (chybaUctu) {
      chyba.textContent = chybaUctu.message;
      chyba.hidden = false;
    } finally {
      tlacitko.disabled = false;
    }
  }

  async function smazUcet(u) {
    const zprava = `Smazat účet „${u.zobrazit || u.jmeno}“?\n\nKlíč, který byl v účtu, zrušte i na GitHubu (Settings → Developer settings → Fine-grained tokens) — smazáním účtu sám platit nepřestane.`;
    if (!confirm(zprava)) return;
    try {
      await zapisUcty((ucty) => {
        const i = ucty.findIndex((x) => x.jmeno === u.jmeno);
        if (i >= 0) ucty.splice(i, 1);
      }, `Správa${kdo()}: smazán účet ${u.jmeno}`);
      await vykresliUcty();
      oznam('Účet je smazaný.');
    } catch (e) {
      oznam('Účet se nepodařilo smazat: ' + e.message, true);
    }
  }

  // Heslo, které se dobře přepisuje: tři čtveřice bez zaměnitelných znaků
  const noveHeslo = () => [G.nahodne(4), G.nahodne(4), G.nahodne(4)].join('-');

  // =========================================================================
  // změna vlastního hesla
  // =========================================================================
  function otevriZmenuHesla(povinna) {
    const okno = $('#zmena-hesla');
    const f = $('[data-zmena-hesla]');
    f.reset();
    f.elements.uzivatel.value = S.uzivatel.jmeno;
    okno.dataset.povinna = povinna ? '1' : '';
    $('[data-zmena-duvod]').hidden = !povinna;
    $('[data-zavrit]', okno).hidden = !!povinna;
    $('[data-zmena-chyba]').hidden = true;
    if (!okno.open) okno.showModal();
    f.elements.heslo.focus();
  }

  async function ulozNoveHeslo(e) {
    e.preventDefault();
    const f = e.target;
    const chyba = $('[data-zmena-chyba]');
    const tlacitko = f.querySelector('[type="submit"]');
    chyba.hidden = true;
    try {
      const heslo = f.elements.heslo.value;
      if (heslo.length < MIN_HESLO) throw new Error(`Heslo musí mít aspoň ${MIN_HESLO} znaků.`);
      if (heslo !== f.elements.heslo2.value) throw new Error('Hesla se neshodují.');
      tlacitko.disabled = true;
      const balik = await U.zasifruj(JSON.stringify({
        klic: S.klic, repo: S.uloziste.repo, vetev: S.uloziste.vetev, role: S.uzivatel.role,
      }), heslo);
      await zapisUcty((ucty) => {
        const u = ucty.find((x) => x.jmeno === S.uzivatel.jmeno);
        if (!u) throw new Error('Váš účet už neexistuje — ozvěte se správci.');
        Object.assign(u, balik, { zmenitHeslo: false, zmeneno: dnesniDatum() });
      }, `Správa${kdo()}: změna hesla`);
      S.uzivatel.zmenitHeslo = false;
      ulozRelaci();
      $('#zmena-hesla').dataset.povinna = '';
      $('#zmena-hesla').close();
      oznam('Heslo je změněné a platí hned.');
    } catch (chybaHesla) {
      chyba.textContent = chybaHesla.message;
      chyba.hidden = false;
    } finally {
      tlacitko.disabled = false;
    }
  }

  // =========================================================================
  // události aplikace
  // =========================================================================
  let navazano = false;
  function navazAplikaci() {
    if (navazano) return;
    navazano = true;

    $$('[data-zalozka]').forEach((t) => { t.onclick = () => vybratZalozku(t.dataset.zalozka); });
    $('[data-zverejnit]').onclick = zverejni;
    $('[data-zahodit]').onclick = () => {
      if (confirm('Zahodit všechny neuložené úpravy?')) {
        S.nahledy.forEach((url, cesta) => { if (S.nove.has(cesta)) { URL.revokeObjectURL(url); S.nahledy.delete(cesta); } });
        nastavData(JSON.parse(S.puvodni), S.verze);
      }
    };
    $('[data-odhlasit]').onclick = () => {
      if (jeZmeneno() && !confirm('Máte neuložené změny. Opravdu se odhlásit?')) return;
      G.zapis(sessionStorage, RELACE, null);
      window.removeEventListener('beforeunload', varujPredOdchodem);
      location.reload();
    };
    window.addEventListener('beforeunload', varujPredOdchodem);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); zverejni(); }
    });

    // nahrávání
    const vstup = $('[data-soubory]');
    vstup.addEventListener('change', () => { pridejDila(vstup.files); vstup.value = ''; });
    const zona = $('[data-nahravani]');
    const maSoubory = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', (e) => {
      if (S.tazene || !maSoubory(e)) return;
      e.preventDefault();
      zona.classList.add('nad');
    });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) zona.classList.remove('nad'); });
    document.addEventListener('drop', (e) => {
      zona.classList.remove('nad');
      if (S.tazene || !maSoubory(e)) return;
      e.preventDefault();
      const d = editor.open && najdi(S.editovane);
      if (d) pridejFotky(d, e.dataTransfer.files);
      else pridejDila(e.dataTransfer.files);
    });

    $('[data-smazat-ukazky]').onclick = () => {
      const ukazky = S.data.dila.filter((d) => d.ukazka);
      if (!confirm(`Odstranit ${ukazky.length} ukázkových děl? Z webu zmizí po zveřejnění.`)) return;
      S.data.dila = S.data.dila.filter((d) => !d.ukazka);
      ukazky.forEach((d) => d.obrazky.forEach((o) => { odeberSoubor(o.velky); if (o.nahled !== o.velky) odeberSoubor(o.nahled); }));
      vykresliSeznam();
      aktualizujStav();
    };

    // editor
    formEditor.addEventListener('input', zapisEditor);
    formEditor.addEventListener('change', zapisEditor);
    formEditor.addEventListener('submit', (e) => { e.preventDefault(); editor.close(); });
    $('[data-zavrit]', editor).onclick = () => editor.close();
    editor.addEventListener('close', () => { S.editovane = null; });
    editor.addEventListener('click', (e) => { if (e.target === editor) editor.close(); });
    $('[data-smazat-dilo]').onclick = () => smazDilo(S.editovane);
    $$('[data-posun]').forEach((b) => {
      b.onclick = () => {
        const d = najdi(S.editovane);
        const i = S.data.dila.indexOf(d);
        const j = i + Number(b.dataset.posun);
        if (j < 0 || j >= S.data.dila.length) return;
        S.data.dila.splice(i, 1);
        S.data.dila.splice(j, 0, d);
        aktualizujEditor(d);
        vykresliSeznam();
        aktualizujStav();
      };
    });
    const dalsiFoto = $('[data-dalsi-foto]');
    dalsiFoto.addEventListener('change', () => {
      const d = najdi(S.editovane);
      if (d) pridejFotky(d, dalsiFoto.files);
      dalsiFoto.value = '';
    });

    // nastavení
    const zapisNastaveni = (e) => {
      const el = e.target;
      if (!el.name || !el.form) return;
      nastav(S.data.nastaveni, el.name, el.type === 'checkbox' ? el.checked : el.value);
      if (el.name === 'nazev') $$('[data-nazev-webu]').forEach((x) => { x.textContent = el.value || 'Galerie'; });
      if (el.name.startsWith('obchod') || el.name === 'email') kontrolaObchodu();
      if (el.name === 'obchod.zapnuto') vykresliSeznam();
      aktualizujStav();
    };
    formNastaveni.addEventListener('input', zapisNastaveni);
    formNastaveni.addEventListener('change', zapisNastaveni);
    $('[data-pridat-dopravu]').onclick = () => {
      S.data.nastaveni.obchod.doprava.push({ nazev: '', cena: 0, adresa: false });
      vykresliDopravu();
      aktualizujStav();
      const radky = $$('[data-doprava] input');
      if (radky.length) radky[radky.length - 3].focus();
    };
    // vzhled
    const fVzhled = $('[data-vzhled]');
    fVzhled.addEventListener('input', zapisVzhled);
    fVzhled.addEventListener('change', zapisVzhled);
    $('[data-akcent-vychozi]').onclick = () => {
      S.data.nastaveni.vzhled.akcent = '';
      naplnVzhled(false);
      aktualizujStav();
    };
    $$('[name="nahledRezim"]').forEach((r) => r.addEventListener('change', () => {
      S.nahledTmavy = r.value === 'tmavy';
      naplnVzhled(false);
    }));

    // účty
    const fUcet = $('[data-ucet-formular]');
    fUcet.addEventListener('submit', ulozUcet);
    $('[data-ucet-zrusit]').onclick = zrusUpravuUctu;
    $('[data-vygenerovat]').onclick = () => { fUcet.elements.heslo.value = noveHeslo(); };
    fUcet.addEventListener('change', () => {
      $('[data-pole-klice]').hidden = (fUcet.querySelector('[name="zdroj"]:checked') || {}).value === 'muj';
    });
    $('[data-predani-kopirovat]').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('[data-predani-text]').textContent);
        oznam('Zkopírováno.');
      } catch (e) {
        oznam('Kopírování nejde — označte text a zkopírujte ho ručně.', true);
      }
    };

    // změna hesla
    const oknoHesla = $('#zmena-hesla');
    $('[data-zmena-hesla]').addEventListener('submit', ulozNoveHeslo);
    $('[data-zavrit]', oknoHesla).onclick = () => oknoHesla.close();
    oknoHesla.addEventListener('cancel', (e) => { if (oknoHesla.dataset.povinna) e.preventDefault(); });
    $('[data-zmenit-heslo]').onclick = () => otevriZmenuHesla(false);

    const portret = $('[data-portret-soubor]');
    portret.addEventListener('change', () => { nahrajPortret(portret.files[0]); portret.value = ''; });
    $('[data-portret-smazat]').onclick = () => {
      odeberSoubor(S.data.nastaveni.portret);
      S.data.nastaveni.portret = '';
      vykresliPortret();
      aktualizujStav();
    };
  }

  function varujPredOdchodem(e) {
    if (!jeZmeneno()) return;
    e.preventDefault();
    e.returnValue = '';
  }

  start();
})();
