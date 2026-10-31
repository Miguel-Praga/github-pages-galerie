#!/usr/bin/env python3
"""Lokální náhled galerie — i se Správou, která ukládá rovnou do složky.

    python vyvoj.py           http://127.0.0.1:5300/  (správa na /sprava/)
    python vyvoj.py 8000      jiný port

Správa pozná, že běží tady, a místo GitHubu zapisuje do souborů v téhle
složce. Na web se změny dostanou až pushnutím do repozitáře. Server
poslouchá jen na 127.0.0.1 a zapisovat smí jen do data/galerie.json,
data/ucty.json, index.html a obrázků — nic jiného ze složky přepsat nejde.

Jen standardní knihovna, žádné závislosti.
"""

import base64
import hashlib
import json
import os
import re
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

KOREN = Path(__file__).resolve().parent
DATA = KOREN / "data" / "galerie.json"
MAX_POZADAVEK = 300 * 1024 * 1024

# Kam smí Správa zapisovat (a co smí mazat)
POVOLENE = re.compile(
    r"^(?:data/(?:galerie|ucty)\.json|index\.html|"
    r"(?:obrazy|ukazka)/(?:[a-z0-9][a-z0-9._-]*/)*[a-z0-9][a-z0-9._-]*\.(?:webp|jpe?g|png|svg|gif|avif))$"
)


def verze_souboru(cesta: Path) -> str | None:
    try:
        return hashlib.sha1(cesta.read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def bezpecna_cesta(relativni: str) -> Path:
    if not isinstance(relativni, str) or ".." in relativni or not POVOLENE.match(relativni):
        raise ValueError(f"sem se zapisovat nesmí: {relativni!r}")
    cesta = (KOREN / relativni).resolve()
    if KOREN not in cesta.parents:
        raise ValueError(f"cesta mimo složku: {relativni!r}")
    return cesta


def zapis_atomicky(cesta: Path, obsah: bytes) -> None:
    cesta.parent.mkdir(parents=True, exist_ok=True)
    fd, docasny = tempfile.mkstemp(dir=cesta.parent, prefix=".zapis-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(obsah)
        os.replace(docasny, cesta)
    except BaseException:
        Path(docasny).unlink(missing_ok=True)
        raise


class Obsluha(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(KOREN), **kwargs)

    # Nic se nekešuje — po uložení musí být vidět nový stav hned.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/__vyvoj/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def posli_json(self, kod: int, data: dict) -> None:
        telo = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(telo)))
        self.end_headers()
        self.wfile.write(telo)

    def do_GET(self):
        cesta = urlsplit(self.path).path
        if cesta == "/__vyvoj/stav":
            return self.posli_json(200, {"rezim": "lokalni", "slozka": KOREN.name})
        if cesta == "/__vyvoj/data":
            return self.posli_json(200, {"text": DATA.read_text(encoding="utf-8"), "verze": verze_souboru(DATA)})
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/__vyvoj/ulozit":
            return self.posli_json(404, {"chyba": "neznámá adresa"})

        # Jiná stránka otevřená v prohlížeči by sem jinak mohla poslat formulář.
        puvod = self.headers.get("Origin", "")
        hostitel = self.headers.get("Host", "")
        if puvod and urlsplit(puvod).netloc != hostitel:
            return self.posli_json(403, {"chyba": "požadavek z cizí stránky"})
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.posli_json(415, {"chyba": "čekám JSON"})

        delka = int(self.headers.get("Content-Length") or 0)
        if delka <= 0 or delka > MAX_POZADAVEK:
            return self.posli_json(413, {"chyba": "požadavek je prázdný nebo moc velký"})
        try:
            pozadavek = json.loads(self.rfile.read(delka))
            soubory = pozadavek.get("soubory") or []
            smazat = pozadavek.get("smazat") or []
            zapisy = []
            for s in soubory:
                cil = bezpecna_cesta(s.get("cesta"))
                if "text" in s:
                    obsah = s["text"].encode("utf-8")
                    if cil.suffix == ".json":
                        json.loads(obsah)  # rozbitý JSON by shodil celý web nebo přihlašování
                else:
                    obsah = base64.b64decode(s["base64"], validate=True)
                zapisy.append((cil, obsah))
            mazani = [bezpecna_cesta(c) for c in smazat]
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            return self.posli_json(400, {"chyba": f"špatný požadavek: {e}"})

        ocekavana = pozadavek.get("verze")
        if ocekavana and verze_souboru(DATA) != ocekavana:
            return self.posli_json(409, {"chyba": "Soubor galerie.json se mezitím změnil na disku (třeba git pull). Načtěte správu znovu."})

        for cil, obsah in zapisy:
            zapis_atomicky(cil, obsah)
        for cil in mazani:
            cil.unlink(missing_ok=True)
        print(f"  uloženo: {len(zapisy)} souborů, smazáno: {len(mazani)}")
        return self.posli_json(200, {"verze": verze_souboru(DATA)})


class Server(ThreadingHTTPServer):
    # Na Windows by SO_REUSEADDR dovolilo druhé instanci obsadit stejný
    # port a požadavky by se náhodně dělily mezi starý a nový server.
    allow_reuse_address = False
    daemon_threads = True


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5300
    try:
        server = Server(("127.0.0.1", port), Obsluha)
    except OSError:
        sys.exit(f"Port {port} je obsazený — nejspíš už běží jiný náhled. Zavřete ho, nebo zvolte jiný port: python vyvoj.py 5301")
    print(f"Galerie:  http://127.0.0.1:{port}/")
    print(f"Správa:   http://127.0.0.1:{port}/sprava/")
    print("Ukončení: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
