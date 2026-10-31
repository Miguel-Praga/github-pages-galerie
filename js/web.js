// web.js — veřejná galerie: úvod, mřížka, detail díla, košík a objednávka
//
// Data jsou v jediném souboru data/galerie.json, který píše Správa.
// Objednávka nikam neodchází sama — složí e-mail, který zákazník odešle
// ze své pošty, a ukáže platební údaje s QR kódem.

(function () {
  'use strict';

  const G = window.Galerie;
  const { h, $, $$, cena } = G;

  const KLIC_KOSIKU = 'galerie.kosik';
  const MAX_KUSU = 20;

  const S = {
    nastaveni: {},
    obchod: null,      // nastavení obchodu, nebo null, když je vypnutý
    dila: [],          // jen zveřejněná, v pořadí ze Správy
    filtr: 'vse',
    jenProdej: false,
    viditelna: [],
    detail: { id: null, obrazek: 0, pushnuto: false },
    kosik: [],
  };

  const detail = $('#detail');
  const kosikOkno = $('#kosik');

  // --- start ----------------------------------------------------------------
  async function start() {
    let data;
    try {
      const odp = await fetch('data/galerie.json', { cache: 'no-cache' });
      if (!odp.ok) throw new Error(odp.status);
      data = await odp.json();
    } catch (e) {
      $('[data-prazdne]').textContent = 'Galerii se nepodařilo načíst. Zkuste stránku obnovit.';
      $('[data-prazdne]').hidden = false;
      document.documentElement.classList.remove('ceka');
      return;
    }
    S.nastaveni = data.nastaveni || {};
    S.obchod = S.nastaveni.obchod && S.nastaveni.obchod.zapnuto ? S.nastaveni.obchod : null;
    S.dila = (data.dila || []).filter((d) => d.zverejneno !== false && d.obrazky && d.obrazky.length);

    nastavVzhled();
    vykresliNastaveni();
    vykresliVybrane();
    vykresliFiltry();
    vykresliMrizku();
    nactiKosik();
    navaz();
    podleAdresy();
    document.documentElement.classList.remove('ceka');
  }

  // Vzhled ze Správy; při režimu „podle zařízení“ sleduje přepnutí
  // světlý/tmavý za běhu. Spočítané barvy si pamatuje pro vzhled.js.
  function nastavVzhled() {
    const v = S.nastaveni.vzhled || {};
    const dotaz = window.matchMedia('(prefers-color-scheme: dark)');
    const pouzij = () => G.pouzijVzhled(document.documentElement, v, dotaz.matches);
    pouzij();
    dotaz.addEventListener('change', () => { pouzij(); rozvrhni(); });
    const styl = G.VZHLEDY[v.styl] || G.VZHLEDY.papir;
    G.zapis(localStorage, 'galerie.vzhled', {
      svetly: G.tokenyVzhledu(v, false).tokeny,
      tmavy: G.tokenyVzhledu(v, true).tokeny,
      pevny: styl.jenTmavy ? 'tmavy' : (v.rezim === 'svetly' || v.rezim === 'tmavy' ? v.rezim : null),
      ramy: v.ramy || 'zadne',
      velikost: v.velikost || 'stredni',
    });
  }

  // --- texty z nastavení ----------------------------------------------------
  function vykresliNastaveni() {
    const n = S.nastaveni;
    const nazev = n.nazev || 'Galerie';
    document.title = n.podtitul ? `${nazev} — ${n.podtitul}` : nazev;
    $$('[data-nazev]').forEach((el) => { el.textContent = nazev; });
    naplnText('[data-autorka]', n.autorka);
    naplnText('[data-podtitul]', n.podtitul);
    $('[data-uvod]').replaceChildren(...G.odstavce(n.uvod));

    const maAutorku = !!(n.oAutorce || n.portret);
    $('#o-autorce').hidden = !maAutorku;
    $('[data-o-autorce]').hidden = !maAutorku;
    $('[data-o-autorce-text]').replaceChildren(...G.odstavce(n.oAutorce));
    const portret = $('[data-portret]');
    portret.hidden = !n.portret;
    $('#o-autorce').classList.toggle('bez-portretu', !n.portret);
    if (n.portret) portret.replaceChildren(h('img', { src: G.adresaObrazku(n.portret), alt: n.autorka || 'Autorka', loading: 'lazy' }));

    const odkazy = kontaktniOdkazy(n);
    $('[data-odkazy-autorky]').replaceChildren(...odkazy.map((o) => o.cloneNode(true)));
    $('[data-kontakt]').replaceChildren(...odkazy);
    $('[data-copyright]').textContent = `© ${new Date().getFullYear()} ${n.autorka || nazev}`;

    $$('[data-obchod]').forEach((el) => { el.hidden = !S.obchod; });
    if (S.obchod) {
      $('[data-podminky]').replaceChildren(...G.odstavce(S.obchod.podminky));
      const platby = zpusobyPlatby();
      $('[data-zpusob-platby]').textContent = platby.length
        ? platby.map((p) => p.popis).join(' nebo ') + '.'
        : 'Způsob platby domluvíme e-mailem.';
    }
  }

  function naplnText(vyber, text) {
    const el = $(vyber);
    el.textContent = text || '';
    el.hidden = !text;
  }

  function kontaktniOdkazy(n) {
    const odkazy = [];
    if (n.email) odkazy.push(h('a', { href: 'mailto:' + n.email }, n.email));
    if (n.telefon) odkazy.push(h('a', { href: 'tel:' + n.telefon.replace(/\s+/g, '') }, n.telefon));
    if (n.instagram) {
      const ucet = n.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
      odkazy.push(h('a', { href: 'https://www.instagram.com/' + encodeURIComponent(ucet) + '/', rel: 'noopener', target: '_blank' }, 'Instagram @' + ucet));
    }
    return odkazy;
  }

  // --- úvodní obraz ---------------------------------------------------------
  function vykresliVybrane() {
    const fig = $('[data-vybrane]');
    const dilo = S.dila.find((d) => d.doporucene) || S.dila[0];
    $('.uvod').classList.toggle('bez-obrazu', !dilo);
    if (!dilo) { fig.hidden = true; return; }
    const o = dilo.obrazky[0];
    fig.replaceChildren(
      h('div', { class: 'ram' }, h('img', {
        src: G.adresaObrazku(o.velky || o.nahled), alt: dilo.nazev, width: o.sirka, height: o.vyska, fetchpriority: 'high',
      })),
      h('figcaption', {}, [dilo.nazev, dilo.rok].filter(Boolean).join(', ')),
    );
    fig.hidden = false;
    fig.onclick = () => otevriDetail(dilo.id);
  }

  // --- filtry a mřížka ------------------------------------------------------
  function vykresliFiltry() {
    const serie = [...new Set(S.dila.map((d) => d.serie).filter(Boolean))];
    const nekdoProdava = S.obchod && S.dila.some(nabizi);
    const box = $('[data-filtry]');
    if (!serie.length && !nekdoProdava) { box.hidden = true; return; }
    const tlacitko = (popis, hodnota) => h('button', {
      class: 'filtr', type: 'button', 'aria-pressed': String(S.filtr === hodnota),
      onclick: () => { S.filtr = hodnota; vykresliFiltry(); vykresliMrizku(); },
    }, popis);
    box.replaceChildren(
      ...(serie.length ? [tlacitko('Vše', 'vse'), ...serie.map((s) => tlacitko(s, s))] : []),
      nekdoProdava && h('button', {
        class: 'filtr prodej', type: 'button', 'aria-pressed': String(S.jenProdej),
        onclick: () => { S.jenProdej = !S.jenProdej; vykresliFiltry(); vykresliMrizku(); },
      }, 'Na prodej'),
    );
  }

  // Dá se u díla něco koupit (originál nebo tisk)?
  function nabizi(d) {
    return (d.stav === 'prodej' && d.cena > 0) || !!(d.tisk && d.tisk.cena > 0);
  }

  function vykresliMrizku() {
    S.viditelna = S.dila.filter((d) => (S.filtr === 'vse' || d.serie === S.filtr) && (!S.jenProdej || nabizi(d)));
    const mrizka = $('[data-mrizka]');
    mrizka.replaceChildren(...S.viditelna.map((d, i) => dlazdice(d, i)));
    rozvrhni();
    const prazdne = $('[data-prazdne]');
    prazdne.hidden = S.viditelna.length > 0;
    if (!S.viditelna.length) prazdne.textContent = S.dila.length ? 'Tomuhle výběru nic neodpovídá.' : 'Tady zatím nic není — galerie se právě připravuje.';
  }

  // Řádky se plní, dokud při cílové výšce nepřetečou šířku; pak se celý
  // řádek přepočítá, aby přesně sedl. Když by poslední přidaný (třeba
  // široké panorama) řádek moc snížil, zalomí se radši před ním a řádek
  // se trochu zvětší. Poslední neúplný řádek zůstane v cílové výšce.
  function rozvrhni() {
    const mrizka = $('[data-mrizka]');
    const styl = getComputedStyle(mrizka);
    const sirka = Math.floor(mrizka.getBoundingClientRect().width); // dolů, ať řádek nepřeteče o zlomek pixelu
    const cil = parseFloat(styl.getPropertyValue('--radek')) || 260;
    const mezera = parseFloat(styl.columnGap) || 0;
    const dlazdice = Array.from(mrizka.children);
    let radek = [];
    let soucet = 0;
    const uzavri = (plny) => {
      const volno = sirka - mezera * (radek.length - 1);
      const vyska = plny ? volno / soucet : cil;
      let zbyva = volno;
      radek.forEach((el, i) => {
        const w = plny && i === radek.length - 1 ? zbyva : Math.floor(Number(el.dataset.p) * vyska);
        zbyva -= w;
        el.style.width = w + 'px';
        el.style.height = Math.round(vyska) + 'px';
      });
      radek = [];
      soucet = 0;
    };
    const vyskaRadku = (pocet, pomery) => (sirka - mezera * (pocet - 1)) / pomery;
    dlazdice.forEach((el) => {
      const p = Number(el.dataset.p);
      if (!radek.length || (soucet + p) * cil + mezera * radek.length < sirka) {
        radek.push(el);
        soucet += p;
        return;
      }
      const sNim = vyskaRadku(radek.length + 1, soucet + p);
      const bezNej = vyskaRadku(radek.length, soucet);
      if (bezNej <= cil * 1.35 && Math.abs(bezNej - cil) < Math.abs(sNim - cil)) {
        uzavri(true);
        radek.push(el);
        soucet = p;
      } else {
        radek.push(el);
        soucet += p;
        uzavri(true);
      }
    });
    if (radek.length) uzavri(soucet * cil + mezera * (radek.length - 1) >= sirka);
  }

  function dlazdice(d, i) {
    const o = d.obrazky[0];
    const pomer = o.sirka && o.vyska ? o.sirka / o.vyska : 1;
    const podnadpis = [d.rok, d.technika].filter(Boolean).join(' · ');
    return h('figure', { class: 'dlazdice', dataset: { p: pomer.toFixed(4) }, styl: { '--p': pomer.toFixed(4), '--i': Math.min(i, 14) } },
      h('img', { src: G.adresaObrazku(o.nahled || o.velky), alt: d.nazev, loading: i < 6 ? 'eager' : 'lazy', decoding: 'async', width: o.sirka, height: o.vyska }),
      jeNovinka(d) && h('span', { class: 'tecka', title: 'Novinka' }),
      h('figcaption', {},
        h('span', { class: 'titulek' }, d.nazev, podnadpis && h('small', {}, podnadpis)),
        stitekDlazdice(d)),
      h('button', { type: 'button', 'aria-label': 'Otevřít: ' + d.nazev, onclick: () => otevriDetail(d.id) }),
    );
  }

  // Novinka = přidané v posledních šesti týdnech
  function jeNovinka(d) {
    const kdy = Date.parse(d.pridano || '');
    return Number.isFinite(kdy) && Date.now() - kdy < 42 * 864e5;
  }

  function stitekDlazdice(d) {
    if (!S.obchod) return null;
    if (d.stav === 'prodej' && d.cena > 0) return h('span', { class: 'stitek' }, cena(d.cena));
    if (d.stav === 'rezervovano') return h('span', { class: 'stitek rezervovano' }, 'Rezervováno');
    if (d.stav === 'prodano') return h('span', { class: 'stitek prodano' }, d.tisk && d.tisk.cena ? 'Tisk ' + cena(d.tisk.cena) : 'Prodáno');
    if (d.tisk && d.tisk.cena > 0) return h('span', { class: 'stitek' }, 'Tisk ' + cena(d.tisk.cena));
    return null;
  }

  // --- detail díla ----------------------------------------------------------
  const najdi = (id) => S.dila.find((d) => d.id === id);

  function otevriDetail(id, { nahradit } = {}) {
    if (!najdi(id)) return;
    S.detail.id = id;
    S.detail.obrazek = 0;
    vykresliDetail();
    if (!detail.open) detail.showModal();
    const hash = '#dilo/' + id;
    if (location.hash !== hash) {
      if (nahradit || location.hash.startsWith('#dilo/')) history.replaceState(null, '', hash);
      else { history.pushState(null, '', hash); S.detail.pushnuto = true; }
    }
  }

  function posun(smer) {
    const seznam = S.viditelna.some((d) => d.id === S.detail.id) ? S.viditelna : S.dila;
    const i = seznam.findIndex((d) => d.id === S.detail.id);
    const dalsi = seznam[(i + smer + seznam.length) % seznam.length];
    if (dalsi) otevriDetail(dalsi.id, { nahradit: true });
  }

  function vykresliDetail() {
    const d = najdi(S.detail.id);
    const o = d.obrazky[S.detail.obrazek] || d.obrazky[0];
    const img = $('[data-detail-img]');
    // nejdřív rychlý náhled z mezipaměti, velký obrázek se přehodí, až dorazí
    img.classList.add('nacita');
    img.src = G.adresaObrazku(o.nahled || o.velky);
    img.alt = d.nazev;
    const velky = new Image();
    velky.onload = () => { if (S.detail.id === d.id) { img.src = velky.src; img.classList.remove('nacita'); } };
    velky.onerror = () => img.classList.remove('nacita');
    velky.src = G.adresaObrazku(o.velky || o.nahled);

    const vice = S.dila.length > 1;
    $('[data-predchozi]').hidden = !vice;
    $('[data-dalsi]').hidden = !vice;
    $('[data-miniatury]').replaceChildren(...(d.obrazky.length > 1 ? d.obrazky.map((ob, i) => h('button', {
      type: 'button', 'aria-label': `Obrázek ${i + 1}`, 'aria-current': String(i === S.detail.obrazek),
      onclick: () => { S.detail.obrazek = i; vykresliDetail(); },
    }, h('img', { src: G.adresaObrazku(ob.nahled || ob.velky), alt: '' }))) : []));

    $('[data-detail-serie]').textContent = d.serie || '';
    $('[data-detail-nazev]').textContent = d.nazev;
    $('[data-detail-udaje]').textContent = [d.rok, d.technika, d.rozmer].filter(Boolean).join(' · ');
    $('[data-detail-popis]').replaceChildren(...G.odstavce(d.popis));
    $('[data-detail-nabidka]').replaceChildren(...nabidka(d));

    const zeptat = $('[data-zeptat]');
    zeptat.hidden = !S.nastaveni.email;
    if (S.nastaveni.email) {
      zeptat.href = mailto(S.nastaveni.email, `Dotaz na dílo „${d.nazev}“`, `Dobrý den,\n\nmám dotaz k dílu „${d.nazev}“ (${odkazNaDilo(d.id)}):\n\n`);
    }
  }

  function nabidka(d) {
    if (!S.obchod) return [];
    const polozky = [];
    if (d.stav !== 'vystaveno' && d.cena > 0) {
      const vKosiku = S.kosik.some((p) => p.id === d.id && p.druh === 'original');
      let akce;
      if (d.stav === 'prodej') {
        akce = vKosiku
          ? h('button', { class: 'tlacitko', type: 'button', onclick: otevriKosik }, 'V košíku ✓ — zobrazit')
          : h('button', { class: 'tlacitko plne', type: 'button', onclick: () => pridej(d.id, 'original') }, 'Vložit do košíku');
      } else {
        akce = h('p', { class: 'pozn' }, d.stav === 'prodano' ? 'Originál už má nového majitele.' : 'Originál je právě rezervovaný.');
      }
      polozky.push(h('div', { class: 'nabidka-polozka ' + d.stav },
        h('span', { class: 'co' }, 'Originál'),
        h('span', { class: 'cena' }, cena(d.cena)),
        h('span', { class: 'stav ' + d.stav }, G.STAVY[d.stav]),
        h('div', { class: 'akce' }, akce)));
    }
    if (d.tisk && d.tisk.cena > 0) {
      const tisku = (S.kosik.find((p) => p.id === d.id && p.druh === 'tisk') || {}).ks;
      polozky.push(h('div', { class: 'nabidka-polozka' },
        h('span', { class: 'co' }, 'Tisk'),
        h('span', { class: 'cena' }, cena(d.tisk.cena)),
        h('span', { class: 'pozn' }, d.tisk.popis || 'Reprodukce na kvalitním papíře'),
        h('div', { class: 'akce' }, h('button', { class: 'tlacitko', type: 'button', onclick: () => pridej(d.id, 'tisk') },
          tisku ? `Přidat další tisk (v košíku ${tisku})` : 'Přidat tisk do košíku'))));
    }
    return polozky;
  }

  function odkazNaDilo(id) {
    return location.href.split('#')[0] + '#dilo/' + id;
  }

  function zavrenDetail() {
    if (!location.hash.startsWith('#dilo/')) return;
    if (S.detail.pushnuto) { S.detail.pushnuto = false; history.back(); }
    else history.replaceState(null, '', location.pathname + location.search);
  }

  function podleAdresy() {
    const m = /^#dilo\/([\w-]+)/.exec(location.hash);
    if (m && najdi(m[1])) otevriDetail(m[1], { nahradit: true });
    else if (detail.open) { S.detail.pushnuto = false; detail.close(); }
  }

  // --- košík ----------------------------------------------------------------
  function nactiKosik() {
    const ulozeny = G.precti(localStorage, KLIC_KOSIKU, []);
    S.kosik = (Array.isArray(ulozeny) ? ulozeny : []).filter((p) => {
      const d = najdi(p.id);
      if (!S.obchod || !d) return false;
      if (p.druh === 'original') return d.stav === 'prodej' && d.cena > 0;
      return p.druh === 'tisk' && d.tisk && d.tisk.cena > 0;
    });
    ulozKosik();
  }

  function ulozKosik() {
    G.zapis(localStorage, KLIC_KOSIKU, S.kosik.map(({ id, druh, ks }) => ({ id, druh, ks })));
    const pocet = S.kosik.reduce((s, p) => s + p.ks, 0);
    const odznak = $('[data-pocet]');
    odznak.textContent = pocet;
    odznak.hidden = !pocet;
  }

  function pridej(id, druh) {
    const polozka = S.kosik.find((p) => p.id === id && p.druh === druh);
    if (polozka) {
      if (druh === 'tisk') polozka.ks = Math.min(MAX_KUSU, polozka.ks + 1);
    } else {
      S.kosik.push({ id, druh, ks: 1 });
    }
    ulozKosik();
    const odznak = $('[data-pocet]');
    odznak.classList.remove('cuk');
    void odznak.offsetWidth;
    odznak.classList.add('cuk');
    oznam(druh === 'tisk' ? 'Tisk je v košíku' : 'Obraz je v košíku');
    if (detail.open) vykresliDetail();
  }

  function cenaPolozky(p) {
    const d = najdi(p.id);
    return (p.druh === 'original' ? d.cena : d.tisk.cena) * p.ks;
  }

  function vybranaDoprava() {
    const moznosti = S.obchod.doprava || [];
    const i = Number(($('[name="doprava"]:checked', kosikOkno) || {}).value || 0);
    return moznosti[i] || null;
  }

  function zpusobyPlatby() {
    const o = S.obchod || {};
    const platby = [];
    if (o.ucet) platby.push({ kod: 'prevod', nazev: 'Převodem na účet', popis: 'Převodem na účet — stačí naskenovat QR kód' });
    if (o.hotove) platby.push({ kod: 'hotove', nazev: 'Hotově při převzetí', popis: 'hotově při osobním převzetí' });
    return platby;
  }

  function otevriKosik() {
    if (detail.open) detail.close();
    ukazKrok('polozky');
    vykresliKosik();
    if (!kosikOkno.open) kosikOkno.showModal();
  }

  function ukazKrok(krok) {
    $$('[data-krok]', kosikOkno).forEach((el) => { el.hidden = el.dataset.krok !== krok; });
    $('#kosik-nadpis').textContent = krok === 'polozky' ? 'Košík' : 'Odeslat objednávku';
  }

  function vykresliKosik() {
    const seznam = $('[data-polozky]', kosikOkno);
    seznam.replaceChildren(...S.kosik.map((p) => {
      const d = najdi(p.id);
      const o = d.obrazky[0];
      return h('li', { class: 'polozka' },
        h('img', { src: G.adresaObrazku(o.nahled || o.velky), alt: '' }),
        h('div', {},
          h('div', { class: 'nazev' }, d.nazev),
          h('div', { class: 'druh' }, p.druh === 'original' ? 'Originál' + (d.rozmer ? ', ' + d.rozmer : '') : 'Tisk' + (d.tisk.popis ? ' — ' + d.tisk.popis : ''))),
        h('div', { class: 'vpravo' },
          h('strong', {}, cena(cenaPolozky(p))),
          p.druh === 'tisk' && h('span', { class: 'mnozstvi' },
            h('button', { type: 'button', 'aria-label': 'Ubrat kus', onclick: () => zmenKusy(p, -1) }, '−'),
            h('span', {}, p.ks),
            h('button', { type: 'button', 'aria-label': 'Přidat kus', onclick: () => zmenKusy(p, 1) }, '+')),
          h('button', { class: 'odkaz odebrat', type: 'button', onclick: () => odeber(p) }, 'odebrat')));
    }));
    const prazdny = !S.kosik.length;
    $('[data-kosik-prazdny]', kosikOkno).hidden = !prazdny;
    $('[data-formular]', kosikOkno).hidden = prazdny;
    if (prazdny) return;

    const doprava = $('[data-doprava]', kosikOkno);
    if (!doprava.querySelector('input')) {
      const moznosti = S.obchod.doprava && S.obchod.doprava.length ? S.obchod.doprava : [{ nazev: 'Domluvíme se', cena: 0 }];
      if (!S.obchod.doprava || !S.obchod.doprava.length) S.obchod.doprava = moznosti;
      doprava.append(...moznosti.map((m, i) => h('label', { class: 'volba' },
        h('input', { type: 'radio', name: 'doprava', value: i, checked: i === 0, onchange: prepocitej }),
        h('span', {}, m.nazev),
        h('span', { class: 'cena' }, m.cena > 0 ? cena(m.cena) : 'zdarma'))));
      const platby = zpusobyPlatby();
      const platba = $('[data-platba]', kosikOkno);
      platba.hidden = !platby.length;
      platba.append(...platby.map((p, i) => h('label', { class: 'volba' },
        h('input', { type: 'radio', name: 'platba', value: p.kod, checked: i === 0 }),
        h('span', {}, p.nazev))));
    }
    prepocitej();
  }

  function prepocitej() {
    const doprava = vybranaDoprava();
    const zasilka = !!(doprava && doprava.adresa);
    $('[data-adresa]', kosikOkno).hidden = !zasilka;
    // hotově se dá platit jen při osobním převzetí
    const platby = $$('[name="platba"]', kosikOkno);
    platby.forEach((p) => { p.closest('label').hidden = zasilka && p.value === 'hotove'; });
    const viditelne = platby.filter((p) => !p.closest('label').hidden);
    if (viditelne.length && !viditelne.some((p) => p.checked)) viditelne[0].checked = true;
    $('[data-platba]', kosikOkno).hidden = !viditelne.length;
    const celkem = S.kosik.reduce((s, p) => s + cenaPolozky(p), 0) + ((doprava && doprava.cena) || 0);
    $('[data-celkem]', kosikOkno).textContent = cena(celkem);
    return celkem;
  }

  function zmenKusy(p, o) {
    p.ks = Math.max(1, Math.min(MAX_KUSU, p.ks + o));
    ulozKosik();
    vykresliKosik();
  }

  function odeber(p) {
    S.kosik = S.kosik.filter((x) => x !== p);
    ulozKosik();
    vykresliKosik();
  }

  // --- objednávka -----------------------------------------------------------
  function odesli(e) {
    e.preventDefault();
    const form = e.target;
    const chyba = $('[data-chyba]', kosikOkno);
    const doprava = vybranaDoprava();
    const hodnota = (n) => form.elements[n].value.trim();
    let problem = '';
    if (!hodnota('jmeno')) problem = 'Vyplňte prosím jméno.';
    else if (!hodnota('email') || !form.elements.email.checkValidity()) problem = 'Zkontrolujte prosím e-mail.';
    else if (doprava && doprava.adresa && !hodnota('adresa')) problem = 'Pro zaslání potřebujeme doručovací adresu.';
    chyba.textContent = problem;
    chyba.hidden = !problem;
    if (problem) return;

    const ted = new Date();
    const dva = (n) => String(n).padStart(2, '0');
    const vs = String(ted.getFullYear()).slice(2) + dva(ted.getMonth() + 1) + dva(ted.getDate()) + dva(ted.getHours()) + dva(ted.getMinutes());
    const zvolena = $$('[name="platba"]', form).find((p) => p.checked && !p.closest('label').hidden);
    const platbaKod = zvolena ? zvolena.value : '';
    const celkem = prepocitej();
    const nazevWebu = S.nastaveni.nazev || 'Galerie';
    const radky = [
      `Objednávka č. ${vs}`,
      `Datum: ${ted.toLocaleDateString('cs-CZ')}`,
      '',
      'Položky:',
      ...S.kosik.map((p) => {
        const d = najdi(p.id);
        const druh = p.druh === 'original' ? 'originál' : `tisk${p.ks > 1 ? ' × ' + p.ks : ''}`;
        return `- ${d.nazev} — ${druh}: ${cena(cenaPolozky(p))}`;
      }),
      doprava ? `Doprava: ${doprava.nazev}: ${doprava.cena > 0 ? cena(doprava.cena) : 'zdarma'}` : null,
      `Celkem: ${cena(celkem)}`,
      '',
      platbaKod === 'prevod' ? `Platba: převodem na účet ${S.obchod.ucet}, variabilní symbol ${vs}` : null,
      platbaKod === 'hotove' ? 'Platba: hotově při převzetí' : null,
      !platbaKod ? 'Platba: domluvíme se' : null,
      platbaKod === 'prevod' ? '(Zaplatím až po potvrzení objednávky.)' : null,
      '',
      `Jméno: ${hodnota('jmeno')}`,
      `E-mail: ${hodnota('email')}`,
      hodnota('telefon') && `Telefon: ${hodnota('telefon')}`,
      doprava && doprava.adresa && `Adresa: ${hodnota('adresa').replace(/\n+/g, ', ')}`,
      hodnota('poznamka') && `Poznámka: ${hodnota('poznamka')}`,
    ].filter((r) => r != null && r !== false);
    const text = radky.join('\n');

    $('[data-rekapitulace]', kosikOkno).textContent = text;
    const email = S.nastaveni.email || '';
    const odkaz = $('[data-mailto]', kosikOkno);
    odkaz.href = mailto(email, `Objednávka č. ${vs} — ${nazevWebu}`, text, hodnota('email'));
    const emailProdejce = $('[data-email-prodejce]', kosikOkno);
    emailProdejce.textContent = email;
    emailProdejce.href = 'mailto:' + email;
    odkaz.hidden = !email;
    $('[data-zalozni-postup]', kosikOkno).hidden = !email;
    $('[data-bez-emailu]', kosikOkno).hidden = !!email;
    $('[data-kopirovat]', kosikOkno).onclick = () => kopiruj(text, 'Text objednávky je ve schránce');
    $('[data-platebni]', kosikOkno).replaceChildren(...(platbaKod === 'prevod' ? platebniUdaje(celkem, vs) : []));
    $('[data-platebni]', kosikOkno).hidden = platbaKod !== 'prevod';
    ukazKrok('odeslat');
    kosikOkno.querySelector('.kosik-krok:not([hidden])').scrollTop = 0;
  }

  function platebniUdaje(castka, vs) {
    const o = S.obchod;
    const { iban } = G.qr.ucetNaIban(o.ucet);
    const zprava = `Objednavka ${vs}`;
    const radky = [
      ['Účet', o.ucet],
      ['Částka', cena(castka)],
      ['VS', vs],
      o.prijemce && ['Příjemce', o.prijemce],
    ].filter(Boolean);
    const dl = h('dl', {}, radky.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const prvky = [];
    if (iban) prvky.push(G.qr.svg(G.qr.platba({ iban, castka, vs, zprava, prijemce: o.prijemce }), 'QR Platba'));
    prvky.push(dl, h('p', { class: 'pozn' }, iban
      ? 'QR kód naskenujte v aplikaci banky. Plaťte prosím až po našem potvrzení, že je dílo vaše.'
      : 'Plaťte prosím až po našem potvrzení, že je dílo vaše.'));
    return prvky;
  }

  function mailto(komu, predmet, text, kopie) {
    const parametry = [`subject=${encodeURIComponent(predmet)}`, `body=${encodeURIComponent(text.replace(/\n/g, '\r\n'))}`];
    if (kopie) parametry.unshift(`cc=${encodeURIComponent(kopie)}`);
    return `mailto:${encodeURIComponent(komu).replace(/%40/g, '@')}?${parametry.join('&')}`;
  }

  async function kopiruj(text, hlaska) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const pole = h('textarea', { readonly: true }, text);
      document.body.append(pole);
      pole.select();
      document.execCommand('copy');
      pole.remove();
    }
    oznam(hlaska);
  }

  let casovac;
  function oznam(text) {
    const el = $('[data-oznameni]');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(casovac);
    casovac = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // --- události -------------------------------------------------------------
  function navaz() {
    const hlavicka = $('.hlavicka');
    const priPosunu = () => hlavicka.classList.toggle('posunuto', window.scrollY > 8);
    window.addEventListener('scroll', priPosunu, { passive: true });
    priPosunu();

    window.addEventListener('popstate', podleAdresy);
    let sirkaMrizky = 0;
    new ResizeObserver(([zaznam]) => {
      const w = Math.round(zaznam.contentRect.width);
      if (w !== sirkaMrizky) { sirkaMrizky = w; rozvrhni(); }
    }).observe($('[data-mrizka]'));
    $('[data-zavrit]', detail).onclick = () => detail.close();
    $('[data-predchozi]', detail).onclick = () => posun(-1);
    $('[data-dalsi]', detail).onclick = () => posun(1);
    $('[data-sdilet]', detail).onclick = () => kopiruj(odkazNaDilo(S.detail.id), 'Odkaz je ve schránce');
    detail.addEventListener('close', zavrenDetail);
    detail.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') posun(-1);
      if (e.key === 'ArrowRight') posun(1);
    });
    // klik do závoje kolem okna zavírá
    [detail, kosikOkno].forEach((okno) => okno.addEventListener('click', (e) => { if (e.target === okno) okno.close(); }));

    // přejetí prstem po obrázku
    const plocha = $('[data-detail-obraz]');
    let zacatek = null;
    plocha.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') zacatek = e.clientX; });
    plocha.addEventListener('pointerup', (e) => {
      if (zacatek == null) return;
      const dx = e.clientX - zacatek;
      zacatek = null;
      if (Math.abs(dx) > 50) posun(dx < 0 ? 1 : -1);
    });
    plocha.addEventListener('pointercancel', () => { zacatek = null; });

    $('.kosik-tlacitko').onclick = otevriKosik;
    $('[data-zavrit]', kosikOkno).onclick = () => kosikOkno.close();
    $('[data-formular]', kosikOkno).addEventListener('submit', odesli);
    $('[data-zpet]', kosikOkno).onclick = () => ukazKrok('polozky');
    $('[data-hotovo]', kosikOkno).onclick = () => {
      S.kosik = [];
      ulozKosik();
      $('[data-formular]', kosikOkno).reset();
      kosikOkno.close();
      oznam('Děkujeme! Brzy se ozveme.');
    };
  }

  start();
})();
