// web.js — veřejná galerie: úvod, mřížka, detail díla a zájem o díla
//
// Data jsou v jediném souboru data/galerie.json, který píše Správa.
// Zájem o dílo nikam neodchází sám — složí e-mail, který návštěvník
// odešle ze své pošty. Všechno ostatní se domlouvá individuálně.

(function () {
  'use strict';

  const G = window.Galerie;
  const { h, $, $$ } = G;

  const KLIC_VYBERU = 'galerie.zajem';

  const S = {
    nastaveni: {},
    zajem: null,       // nastavení zájmu o díla, nebo null, když je vypnutý
    dila: [],          // jen zveřejněná, v pořadí ze Správy
    filtr: 'vse',
    jenDostupne: false,
    viditelna: [],
    detail: { id: null, obrazek: 0, pushnuto: false },
    vyber: [],         // [{id, druh: 'original'|'tisk'}]
  };

  const detail = $('#detail');
  const zajemOkno = $('#zajem');

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
    const zajem = G.nastaveniZajmu(S.nastaveni);
    S.zajem = zajem.zapnuto ? zajem : null;
    S.dila = (data.dila || [])
      .filter((d) => d.zverejneno !== false && d.obrazky && d.obrazky.length)
      .map((d) => Object.assign({}, d, { stav: G.stavDila(d) }));

    nastavVzhled();
    vykresliNastaveni();
    vykresliVybrane();
    vykresliFiltry();
    vykresliMrizku();
    nactiVyber();
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
    $('[data-kontakt]').replaceChildren(...odkazy);
    $('[data-bez-kontaktu]').hidden = odkazy.length > 0;
    $('[data-copyright]').textContent = `© ${new Date().getFullYear()} ${n.autorka || nazev}`;

    // Celá „zájmová“ část jde jedním přepínačem ve Správě úplně schovat.
    $('[data-zajem]').hidden = !S.zajem;
    const text = $('[data-zajem-text]');
    text.hidden = !(S.zajem && S.zajem.text);
    text.replaceChildren(...(S.zajem ? G.odstavce(S.zajem.text) : []));
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
    const neco = S.zajem && S.dila.some(nabizi);
    const box = $('[data-filtry]');
    if (!serie.length && !neco) { box.hidden = true; return; }
    const tlacitko = (popis, hodnota) => h('button', {
      class: 'filtr', type: 'button', 'aria-pressed': String(S.filtr === hodnota),
      onclick: () => { S.filtr = hodnota; vykresliFiltry(); vykresliMrizku(); },
    }, popis);
    box.replaceChildren(
      ...(serie.length ? [tlacitko('Vše', 'vse'), ...serie.map((s) => tlacitko(s, s))] : []),
      neco && h('button', {
        class: 'filtr dostupne', type: 'button', 'aria-pressed': String(S.jenDostupne),
        onclick: () => { S.jenDostupne = !S.jenDostupne; vykresliFiltry(); vykresliMrizku(); },
      }, 'K dispozici'),
    );
  }

  // Dá se u díla projevit zájem (o originál nebo o tisk)?
  const nabiziTisk = (d) => !!d.tisk;
  function nabizi(d) {
    return d.stav === 'dostupne' || nabiziTisk(d);
  }

  function vykresliMrizku() {
    S.viditelna = S.dila.filter((d) => (S.filtr === 'vse' || d.serie === S.filtr) && (!S.jenDostupne || nabizi(d)));
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
    if (!S.zajem) return null;
    if (d.stav === 'rezervovano') return h('span', { class: 'stitek rezervovano' }, G.STAVY.rezervovano);
    if (d.stav === 'sbirka') return h('span', { class: 'stitek sbirka' }, G.STAVY.sbirka);
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
    $('[data-detail-zajem]').replaceChildren(...dostupnost(d));

    const zeptat = $('[data-zeptat]');
    zeptat.hidden = !S.nastaveni.email;
    if (S.nastaveni.email) {
      zeptat.href = mailto(S.nastaveni.email, `Dotaz na dílo „${d.nazev}“`, `Dobrý den,\n\nmám dotaz k dílu „${d.nazev}“ (${odkazNaDilo(d.id)}):\n\n`);
    }
  }

  function dostupnost(d) {
    if (!S.zajem) return [];
    const prvky = [];
    const vybrano = (druh) => S.vyber.some((p) => p.id === d.id && p.druh === druh);
    const tlacitko = (druh, popis) => (vybrano(druh)
      ? h('button', { class: 'tlacitko', type: 'button', onclick: otevriZajem }, 'Vybráno ✓ — zobrazit')
      : h('button', { class: 'tlacitko' + (druh === 'original' ? ' plne' : ''), type: 'button', onclick: () => pridej(d.id, druh) }, popis));

    if (d.stav !== 'vystaveno') prvky.push(h('p', { class: 'stav ' + d.stav }, G.STAVY[d.stav]));
    if (G.maOceneni(d)) prvky.push(h('p', { class: 'oceneni' }, 'Ocenění autorky: ', h('strong', {}, G.castka(d.oceneni))));
    if (d.stav === 'dostupne') {
      prvky.push(tlacitko('original', nabiziTisk(d) ? 'Mám zájem o originál' : 'Mám zájem o toto dílo'));
    }
    if (nabiziTisk(d)) {
      prvky.push(h('div', { class: 'tisk' },
        h('span', {}, 'K dispozici je i tisk' + (d.tisk.popis ? ` (${d.tisk.popis})` : '') + '.'),
        tlacitko('tisk', 'Mám zájem o tisk')));
    }
    return prvky;
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

  // --- výběr děl, o která má návštěvník zájem -------------------------------
  function nactiVyber() {
    const ulozeny = G.precti(localStorage, KLIC_VYBERU, []);
    S.vyber = (Array.isArray(ulozeny) ? ulozeny : []).filter((p) => {
      const d = najdi(p.id);
      if (!S.zajem || !d) return false;
      return p.druh === 'original' ? d.stav === 'dostupne' : p.druh === 'tisk' && nabiziTisk(d);
    });
    ulozVyber();
  }

  function ulozVyber() {
    G.zapis(localStorage, KLIC_VYBERU, S.vyber.map(({ id, druh }) => ({ id, druh })));
    const odznak = $('[data-pocet]');
    odznak.textContent = S.vyber.length;
    odznak.hidden = !S.vyber.length;
  }

  function pridej(id, druh) {
    if (!S.vyber.some((p) => p.id === id && p.druh === druh)) S.vyber.push({ id, druh });
    ulozVyber();
    const odznak = $('[data-pocet]');
    odznak.classList.remove('cuk');
    void odznak.offsetWidth;
    odznak.classList.add('cuk');
    oznam('Přidáno mezi díla, o která máte zájem');
    if (detail.open) vykresliDetail();
  }

  const popisDruhu = (p, d) => (p.druh === 'original'
    ? 'originál' + (d.rozmer ? ', ' + d.rozmer : '')
    : 'tisk' + (d.tisk && d.tisk.popis ? ' — ' + d.tisk.popis : ''));

  function otevriZajem() {
    if (detail.open) detail.close();
    ukazKrok('vyber');
    vykresliVyber();
    if (!zajemOkno.open) zajemOkno.showModal();
  }

  function ukazKrok(krok) {
    $$('[data-krok]', zajemOkno).forEach((el) => { el.hidden = el.dataset.krok !== krok; });
    $('#zajem-nadpis').textContent = krok === 'vyber' ? 'Zájem o díla' : 'Odeslat zprávu';
  }

  function vykresliVyber() {
    $('[data-polozky]', zajemOkno).replaceChildren(...S.vyber.map((p) => {
      const d = najdi(p.id);
      const o = d.obrazky[0];
      return h('li', { class: 'polozka' },
        h('img', { src: G.adresaObrazku(o.nahled || o.velky), alt: '' }),
        h('div', {},
          h('div', { class: 'nazev' }, d.nazev),
          h('div', { class: 'druh' }, popisDruhu(p, d))),
        h('button', { class: 'odkaz odebrat', type: 'button', onclick: () => odeber(p) }, 'odebrat'));
    }));
    const prazdny = !S.vyber.length;
    $('[data-zajem-prazdny]', zajemOkno).hidden = !prazdny;
    $('[data-zajem-uvod]', zajemOkno).hidden = prazdny;
    $('[data-formular]', zajemOkno).hidden = prazdny;
  }

  function odeber(p) {
    S.vyber = S.vyber.filter((x) => x !== p);
    ulozVyber();
    vykresliVyber();
  }

  function odesli(e) {
    e.preventDefault();
    const form = e.target;
    const chyba = $('[data-chyba]', zajemOkno);
    const hodnota = (n) => form.elements[n].value.trim();
    let problem = '';
    if (!hodnota('jmeno')) problem = 'Vyplňte prosím jméno.';
    else if (!hodnota('email') || !form.elements.email.checkValidity()) problem = 'Zkontrolujte prosím e-mail.';
    chyba.textContent = problem;
    chyba.hidden = !problem;
    if (problem) return;

    const nazevWebu = S.nastaveni.nazev || 'Galerie';
    const text = [
      'Dobrý den,',
      '',
      S.vyber.length > 1 ? 'mám zájem o tato díla:' : 'mám zájem o toto dílo:',
      ...S.vyber.map((p) => {
        const d = najdi(p.id);
        return `- ${d.nazev} (${popisDruhu(p, d)}) — ${odkazNaDilo(d.id)}`;
      }),
      '',
      hodnota('zprava') || null,
      hodnota('zprava') ? '' : null,
      hodnota('jmeno'),
      `E-mail: ${hodnota('email')}`,
      hodnota('telefon') ? `Telefon: ${hodnota('telefon')}` : null,
    ].filter((r) => r != null).join('\n');

    $('[data-rekapitulace]', zajemOkno).textContent = text;
    const email = S.nastaveni.email || '';
    const predmet = S.vyber.length === 1 ? `Zájem o dílo „${najdi(S.vyber[0].id).nazev}“` : `Zájem o díla — ${nazevWebu}`;
    const odkaz = $('[data-mailto]', zajemOkno);
    odkaz.href = mailto(email, predmet, text, hodnota('email'));
    const emailAutorky = $('[data-email-autorky]', zajemOkno);
    emailAutorky.textContent = email;
    emailAutorky.href = 'mailto:' + email;
    odkaz.hidden = !email;
    $('[data-zalozni-postup]', zajemOkno).hidden = !email;
    $('[data-bez-emailu]', zajemOkno).hidden = !!email;
    $('[data-kopirovat]', zajemOkno).onclick = () => kopiruj(text, 'Text zprávy je ve schránce');
    ukazKrok('odeslat');
    zajemOkno.querySelector('.zajem-krok:not([hidden])').scrollTop = 0;
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
    [detail, zajemOkno].forEach((okno) => okno.addEventListener('click', (e) => { if (e.target === okno) okno.close(); }));

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

    $('[data-zajem]').onclick = otevriZajem;
    $('[data-zavrit]', zajemOkno).onclick = () => zajemOkno.close();
    $('[data-formular]', zajemOkno).addEventListener('submit', odesli);
    $('[data-zpet]', zajemOkno).onclick = () => ukazKrok('vyber');
    $('[data-hotovo]', zajemOkno).onclick = () => {
      S.vyber = [];
      ulozVyber();
      $('[data-formular]', zajemOkno).reset();
      zajemOkno.close();
      oznam('Děkujeme! Brzy se ozveme.');
    };
  }

  start();
})();
