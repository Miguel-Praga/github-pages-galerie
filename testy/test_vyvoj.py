"""Testy lokálního serveru vyvoj.py — hlavně, kam smí Správa zapisovat.

    python -m unittest discover -s testy
"""

import base64
import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import vyvoj  # noqa: E402


class TestVyvoj(unittest.TestCase):
    def setUp(self):
        self.slozka = Path(tempfile.mkdtemp(prefix="galerie-test-"))
        (self.slozka / "data").mkdir()
        (self.slozka / "data" / "galerie.json").write_text('{"dila": []}', encoding="utf-8")
        (self.slozka / "vyvoj.py").write_text("# nesmí jít přepsat", encoding="utf-8")
        self.puvodni = (vyvoj.KOREN, vyvoj.DATA)
        vyvoj.KOREN = self.slozka.resolve()
        vyvoj.DATA = vyvoj.KOREN / "data" / "galerie.json"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), vyvoj.Obsluha)
        self.adresa = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        vyvoj.KOREN, vyvoj.DATA = self.puvodni
        shutil.rmtree(self.slozka, ignore_errors=True)

    def posli(self, telo, hlavicky=None):
        h = {"Content-Type": "application/json", "Origin": self.adresa}
        h.update(hlavicky or {})
        pozadavek = urllib.request.Request(self.adresa + "/__vyvoj/ulozit", data=json.dumps(telo).encode(), headers=h, method="POST")
        try:
            with urllib.request.urlopen(pozadavek) as odp:
                return odp.status, json.loads(odp.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def verze(self):
        with urllib.request.urlopen(self.adresa + "/__vyvoj/data") as odp:
            return json.loads(odp.read())["verze"]

    def test_ulozi_data_a_obrazek_a_smaze(self):
        stary = self.slozka / "obrazy" / "velke" / "stary.webp"
        stary.parent.mkdir(parents=True)
        stary.write_bytes(b"x")
        kod, odp = self.posli({
            "verze": self.verze(),
            "soubory": [
                {"cesta": "data/galerie.json", "text": '{"dila": [{"id": "a"}]}'},
                {"cesta": "obrazy/nahledy/novy-ab12.webp", "base64": base64.b64encode(b"RIFF....WEBP").decode()},
            ],
            "smazat": ["obrazy/velke/stary.webp"],
        })
        self.assertEqual(kod, 200, odp)
        self.assertEqual((self.slozka / "obrazy" / "nahledy" / "novy-ab12.webp").read_bytes(), b"RIFF....WEBP")
        self.assertFalse(stary.exists())
        self.assertIn('"id": "a"', (self.slozka / "data" / "galerie.json").read_text(encoding="utf-8"))
        self.assertEqual(odp["verze"], self.verze())

    def test_nepusti_mimo_povolene_cesty(self):
        for cesta in ["vyvoj.py", "../venku.json", "obrazy/../vyvoj.py", "obrazy/x.exe", "data/jiny.json",
                      "/etc/passwd", "obrazy/Velke.webp", "C:/Windows/x.webp", ".git/config"]:
            with self.subTest(cesta=cesta):
                kod, _ = self.posli({"soubory": [{"cesta": cesta, "text": "x"}], "smazat": []})
                self.assertEqual(kod, 400)
                kod, _ = self.posli({"soubory": [], "smazat": [cesta]})
                self.assertEqual(kod, 400)
        self.assertEqual((self.slozka / "vyvoj.py").read_text(encoding="utf-8"), "# nesmí jít přepsat")

    def test_ucty_jdou_zapsat_jen_jako_platny_json(self):
        kod, _ = self.posli({"soubory": [{"cesta": "data/ucty.json", "text": '{"ucty": []}'}], "smazat": []})
        self.assertEqual(kod, 200)
        kod, _ = self.posli({"soubory": [{"cesta": "data/ucty.json", "text": "{rozbite"}], "smazat": []})
        self.assertEqual(kod, 400)
        self.assertEqual((self.slozka / "data" / "ucty.json").read_text(encoding="utf-8"), '{"ucty": []}')

    def test_odmitne_cizi_stranku(self):
        kod, _ = self.posli({"soubory": [], "smazat": []}, {"Origin": "https://zla-stranka.example"})
        self.assertEqual(kod, 403)

    def test_odmitne_formular(self):
        kod, _ = self.posli({"soubory": [], "smazat": []}, {"Content-Type": "text/plain"})
        self.assertEqual(kod, 415)

    def test_rozbity_json_galerie_neprojde(self):
        kod, _ = self.posli({"soubory": [{"cesta": "data/galerie.json", "text": "{rozbite"}], "smazat": []})
        self.assertEqual(kod, 400)
        self.assertEqual((self.slozka / "data" / "galerie.json").read_text(encoding="utf-8"), '{"dila": []}')

    def test_soubeh_vrati_409(self):
        stara = self.verze()
        (self.slozka / "data" / "galerie.json").write_text('{"dila": [1]}', encoding="utf-8")  # třeba git pull
        kod, _ = self.posli({"verze": stara, "soubory": [{"cesta": "data/galerie.json", "text": "{}"}], "smazat": []})
        self.assertEqual(kod, 409)
        self.assertEqual((self.slozka / "data" / "galerie.json").read_text(encoding="utf-8"), '{"dila": [1]}')


class TestDataGalerie(unittest.TestCase):
    """Data v repu musí být platná, jinak web nic neukáže."""

    def test_galerie_json(self):
        koren = Path(__file__).resolve().parent.parent
        data = json.loads((koren / "data" / "galerie.json").read_text(encoding="utf-8"))
        self.assertIn("nastaveni", data)
        idcka = [d["id"] for d in data["dila"]]
        self.assertEqual(len(idcka), len(set(idcka)), "duplicitní id děl")
        for d in data["dila"]:
            self.assertIn(d["stav"], {"vystaveno", "prodej", "rezervovano", "prodano"}, d["id"])
            for o in d["obrazky"]:
                for cesta in (o["velky"], o["nahled"]):
                    self.assertTrue((koren / cesta).is_file(), f"chybí {cesta}")

    def test_ucty_json(self):
        koren = Path(__file__).resolve().parent.parent
        data = json.loads((koren / "data" / "ucty.json").read_text(encoding="utf-8"))
        jmena = [u["jmeno"] for u in data["ucty"]]
        self.assertEqual(len(jmena), len(set(jmena)), "duplicitní jména účtů")
        for u in data["ucty"]:
            self.assertIn(u["role"], {"admin", "spravkyne"})
            self.assertTrue({"sul", "iv", "data"} <= u.keys(), "účet bez zašifrovaného klíče")
            self.assertNotIn("github_pat_", json.dumps(u), "nezašifrovaný klíč v účtu")


if __name__ == "__main__":
    unittest.main()
