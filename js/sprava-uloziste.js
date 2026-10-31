// sprava-uloziste.js — kam Správa zapisuje
//
// Dvě úložiště se stejným rozhraním:
//   github   — zapisuje přes GitHub API do repozitáře; GitHub Pages pak web
//              sám přestaví (zhruba do minuty). Všechny změny jednoho
//              uložení jdou jedním commitem, takže se web přestaví jednou.
//   lokalni  — když stránku servíruje vyvoj.py na tomhle počítači; píše
//              rovnou do složky a ven to jde až přes git push.
//
// Rozhraní: nacti() → {text, verze}, nactiSoubor(cesta) → text,
//           uloz({soubory, smazat, zprava, verze}, prubeh) → {verze}
// „verze“ hlídá, aby si dvě zařízení navzájem nepřepsala galerii.

window.Uloziste = (function () {
  'use strict';

  const API = 'https://api.github.com';
  const DATA = 'data/galerie.json';
  const UCTY = 'data/ucty.json';

  class Chyba extends Error {
    constructor(zprava, kod) {
      super(zprava);
      this.kod = kod;
    }
  }

  // --- lokální složka (vyvoj.py) -------------------------------------------
  async function lokalniDostupne() {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
    try {
      const odp = await fetch('/__vyvoj/stav', { cache: 'no-store' });
      return odp.ok ? await odp.json() : null;
    } catch (e) {
      return null;
    }
  }

  function lokalni() {
    return {
      druh: 'lokalni',
      popis: 'lokální složka',
      async nacti() {
        const odp = await fetch('/__vyvoj/data', { cache: 'no-store' });
        if (!odp.ok) throw new Chyba('Lokální server nevrátil data galerie.');
        return odp.json();
      },
      async nactiSoubor(cesta) {
        const odp = await fetch('/' + cesta, { cache: 'no-store' });
        if (!odp.ok) throw new Chyba('Soubor ' + cesta + ' se nepodařilo načíst.', odp.status === 404 ? 'nenalezeno' : 'http' + odp.status);
        return odp.text();
      },
      async uloz({ soubory, smazat, verze }, prubeh) {
        prubeh(0, 1, 'Zapisuji do složky…');
        const odp = await fetch('/__vyvoj/ulozit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verze, soubory, smazat }),
        });
        const vysledek = await odp.json().catch(() => ({}));
        if (odp.status === 409) throw new Chyba(vysledek.chyba || 'Galerie se mezitím změnila.', 'konflikt');
        if (!odp.ok) throw new Chyba(vysledek.chyba || 'Uložení selhalo (' + odp.status + ').');
        prubeh(1, 1, 'Hotovo');
        return { verze: vysledek.verze };
      },
    };
  }

  // --- GitHub ---------------------------------------------------------------
  function github(repo, klic, vetevZNastaveni) {
    let vetev = vetevZNastaveni || '';

    async function api(metoda, cesta, telo) {
      let odp;
      try {
        odp = await fetch(API + '/repos/' + repo + cesta, {
          method: metoda,
          headers: Object.assign(
            { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + klic },
            telo ? { 'Content-Type': 'application/json' } : {},
          ),
          body: telo ? JSON.stringify(telo) : undefined,
          cache: 'no-store',
        });
      } catch (e) {
        throw new Chyba('GitHub není dostupný — zkontrolujte připojení k internetu.', 'sit');
      }
      if (odp.ok) return odp.status === 204 ? null : odp.json();
      const telo2 = await odp.json().catch(() => ({}));
      const zprava = telo2.message || '';
      if (odp.status === 401) throw new Chyba('Přístupový klíč je neplatný nebo vypršel.', 'klic');
      if (odp.status === 403 && /rate limit/i.test(zprava)) throw new Chyba('GitHub dočasně omezil počet požadavků. Zkuste to za chvíli.', 'limit');
      if (odp.status === 403) throw new Chyba('Klíč nemá oprávnění zapisovat (Contents: Read and write).', 'pravo');
      if (odp.status === 404) throw new Chyba('Nenašel jsem ' + (cesta ? 'soubor v repozitáři' : 'repozitář ' + repo) + ' — nebo k němu klíč nemá přístup.', 'nenalezeno');
      if (odp.status === 409) throw new Chyba('Repozitář je prázdný — nahrajte do něj nejdřív soubory webu.', 'prazdny');
      throw new Chyba('GitHub odpověděl chybou ' + odp.status + (zprava ? ': ' + zprava : ''), 'http' + odp.status);
    }

    const zakodujCestu = (cesta) => cesta.split('/').map(encodeURIComponent).join('/');

    function dekoduj(b64) {
      const bajty = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bajty);
    }

    async function obsah(cesta, ref) {
      return api('GET', '/contents/' + zakodujCestu(cesta) + '?ref=' + encodeURIComponent(ref || vetev));
    }

    return {
      druh: 'github',
      get popis() { return repo; },
      get vetev() { return vetev; },
      repo,

      // Ověří klíč a zjistí výchozí větev
      async over() {
        const info = await api('GET', '');
        if (info.permissions && info.permissions.push === false) {
          throw new Chyba('Účet, kterému klíč patří, nemá do repozitáře právo zápisu.', 'pravo');
        }
        if (!vetev) vetev = info.default_branch;
        return info;
      },

      async nacti() {
        const soubor = await obsah(DATA);
        return { text: dekoduj(soubor.content), verze: soubor.sha };
      },

      async nactiSoubor(cesta) {
        return dekoduj((await obsah(cesta)).content);
      },

      async uloz({ soubory, smazat, zprava, verze }, prubeh) {
        // Nejdřív bloby — ty nejsou vázané na stav větve, takže se při
        // opakování (někdo mezitím pushnul) nenahrávají znovu.
        const bloby = [];
        let hotovo = 0;
        let obrazku = 0;
        const celkem = soubory.length + 3;
        const vsechObrazku = soubory.filter((s) => s.text == null).length;
        for (const s of soubory) {
          prubeh(hotovo, celkem, s.text != null ? 'Zapisuji data…' : `Nahrávám obrázky (${++obrazku}/${vsechObrazku})…`);
          const blob = await api('POST', '/git/blobs', s.text != null
            ? { content: s.text, encoding: 'utf-8' }
            : { content: s.base64, encoding: 'base64' });
          bloby.push({ cesta: s.cesta, sha: blob.sha });
          hotovo++;
        }
        const novaVerze = (bloby.find((b) => b.cesta === DATA) || {}).sha || verze;

        for (let pokus = 0; pokus < 3; pokus++) {
          prubeh(hotovo, celkem, 'Připravuji commit…');
          const ref = await api('GET', '/git/ref/heads/' + encodeURIComponent(vetev));
          const hlava = ref.object.sha;
          const commit = await api('GET', '/git/commits/' + hlava);

          // Změnil někdo galerii od chvíle, kdy jsme ji načetli?
          if (verze) {
            const aktualni = await obsah(DATA, hlava).catch((e) => { if (e.kod === 'nenalezeno') return null; throw e; });
            if (aktualni && aktualni.sha !== verze) {
              throw new Chyba('Galerii mezitím změnil někdo jiný (nebo jiné zařízení). Načtěte ji znovu — vaše neuložené úpravy by ji jinak přepsaly.', 'konflikt');
            }
          }

          // Mazat jde jen to, co ve stromu opravdu je, jinak GitHub odmítne celý strom.
          let existuje = () => true;
          if (smazat.length) {
            const strom = await api('GET', '/git/trees/' + commit.tree.sha + '?recursive=1');
            const cesty = new Set(strom.tree.filter((t) => t.type === 'blob').map((t) => t.path));
            existuje = (c) => cesty.has(c);
          }
          const polozky = bloby.map((b) => ({ path: b.cesta, mode: '100644', type: 'blob', sha: b.sha }))
            .concat(smazat.filter(existuje).map((c) => ({ path: c, mode: '100644', type: 'blob', sha: null })));

          const strom = await api('POST', '/git/trees', { base_tree: commit.tree.sha, tree: polozky });
          prubeh(hotovo + 1, celkem, 'Zapisuji commit…');
          const novy = await api('POST', '/git/commits', { message: zprava, tree: strom.sha, parents: [hlava] });
          prubeh(hotovo + 2, celkem, 'Posouvám větev…');
          try {
            await api('PATCH', '/git/refs/heads/' + encodeURIComponent(vetev), { sha: novy.sha, force: false });
          } catch (e) {
            // 422 = větev mezitím poskočila jinam; zkusíme to nad novou hlavou
            if (e.kod === 'http422') continue;
            throw e;
          }
          prubeh(celkem, celkem, 'Hotovo');
          return { verze: novaVerze, commit: novy.sha };
        }
        throw new Chyba('Větev se pořád mění pod rukama. Zkuste uložit znovu.', 'souběh');
      },
    };
  }

  // owner.github.io/repo/sprava/ → owner/repo
  function repoZAdresy() {
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return '';
    const prvni = location.pathname.split('/').filter(Boolean)[0];
    if (!prvni || prvni === 'sprava') return `${m[1]}/${m[1]}.github.io`;
    return `${m[1]}/${prvni}`;
  }

  // Seznam účtů pro přihlašovací obrazovku. Bere se přímo z GitHubu (bez
  // klíče, repo je veřejné), aby nové heslo platilo hned a ne až po
  // přestavění webu; když to nejde, poslouží kopie na webu.
  async function nactiUcty(repo) {
    if (repo) {
      try {
        const odp = await fetch(`${API}/repos/${repo}/contents/${UCTY}`, {
          headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store',
        });
        if (odp.ok) return (await odp.json()).ucty || [];
      } catch (e) { /* zkusíme kopii na webu */ }
    }
    try {
      const odp = await fetch('../' + UCTY, { cache: 'no-cache' });
      if (odp.ok) return (await odp.json()).ucty || [];
    } catch (e) { /* žádné účty */ }
    return [];
  }

  // --- zašifrovaný klíč: AES-GCM s klíčem odvozeným z hesla (PBKDF2) -------
  // Účty leží ve veřejném repu, proto hodně iterací (doporučení OWASP pro
  // PBKDF2-SHA256) a heslo aspoň 10 znaků.
  const ITERACI = 600000;
  const b64 = (bajty) => btoa(String.fromCharCode(...bajty));
  const zB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function odvod(heslo, sul, iteraci) {
    const zaklad = await crypto.subtle.importKey('raw', new TextEncoder().encode(heslo), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sul, iterations: iteraci, hash: 'SHA-256' },
      zaklad, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  }

  async function zasifruj(text, heslo) {
    const sul = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const klic = await odvod(heslo, sul, ITERACI);
    const sifra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, klic, new TextEncoder().encode(text)));
    return { sul: b64(sul), iv: b64(iv), data: b64(sifra), iteraci: ITERACI };
  }

  async function rozsifruj(balik, heslo) {
    const klic = await odvod(heslo, zB64(balik.sul), balik.iteraci || ITERACI);
    try {
      const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: zB64(balik.iv) }, klic, zB64(balik.data));
      return new TextDecoder().decode(text);
    } catch (e) {
      throw new Chyba('Špatné heslo.', 'heslo');
    }
  }

  return { Chyba, lokalniDostupne, lokalni, github, repoZAdresy, nactiUcty, zasifruj, rozsifruj, DATA, UCTY };
})();
