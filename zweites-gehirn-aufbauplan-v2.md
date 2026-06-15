# Zweites Gehirn — Aufbauplan v2 (LiveSync) — Handoff für neuen Agenten

Stand: 2026-06-14. Dieses Dokument ist gleichzeitig Bauplan und Übergabe-Brief für den nächsten
Agenten. Alles Erledigte ist dokumentiert; was noch fehlt, steht in Abschnitt 3.

---

## 0. Für Claude Code — Arbeitsweise

- **Der Nutzer ist nicht kommandozeilen-affin.** Du erledigst die Server-Arbeit.
- **Stufe für Stufe**, jede „Definition of Done" prüfen, bevor es weitergeht.
- **HUMAN-STEP**-Markierungen = nur der Nutzer kann das (in Obsidian klicken, Mobilgerät bedienen).
- **Sicherheit:** CouchDB nie roh ins Internet; Secrets nie in git.
- **Idempotenz:** alles als Docker-Compose + Konfigdateien, in git ablegen.

---

## 1. Architektur (Überblick)

Logische Quelle der Wahrheit: **CouchDB** auf dem Hetzner-Server.

```text
Obsidian (Mac/Android/iPad)
        ↕ LiveSync-Plugin (E2E-verschlüsselt, Echtzeit)
    CouchDB  ←→  Brücke  →  vault-mirror/ (.md-Dateien)
                                ↕               ↕
                           MCP-Server      Graph-Indexer
                               ↓                ↓
                          claude.ai         FalkorDB
```

- **LiveSync** synchronisiert Obsidian-Geräte mit CouchDB in Echtzeit.
- **Brücke** materialisiert CouchDB ↔ `.md`-Spiegel (`vault-mirror/`) — MCP und Indexer lesen/schreiben nur den Spiegel.
- **MCP-Server** gibt Claude Werkzeuge zum Lesen und Schreiben von Notizen.
- **FalkorDB + Indexer** macht `[[Wikilinks]]` zu traversierbaren Graph-Kanten.

---

## 2. Was bereits erledigt ist ✅

### Server-Infrastruktur

| Komponente | Details |
| --- | --- |
| VPS | Hetzner CXP22, Ubuntu 24.04, IP `178.104.38.178` |
| SSH | Alias `ssh hetzner`, Key `~/.ssh/hetzner` |
| Docker | v29.5.3 + Compose v5.1.4 |
| Projektverzeichnis | `/home/hetzner/second-brain/` (git, Branch `main`) |

### CouchDB ✅ (Stage 1)

- CouchDB 3.5.2, Container `brain-couchdb`
- Nur lokal gebunden: `127.0.0.1:5984` — extern nur über den Tunnel erreichbar
- Single-Node initialisiert, CORS aktiv für `app://obsidian.md`, `capacitor://localhost`, `http://localhost`
- Datenbank: `secondbrain` (~1400 Chunks = 68 Notizen)
- Secrets in `/home/hetzner/second-brain/.env` (nicht in git):

```text
COUCHDB_PASSWORD=<stark>
LIVESYNC_PASSPHRASE=<stark>    ← Bridge braucht das zum Entschlüsseln
MCP_BEARER_TOKEN=<stark>
```

### Cloudflare Tunnel ✅

- Tunnel-ID: `c4f03ae1-92cc-4084-9f53-929f5d349c93`
- `brain.canimagin.com` → `http://couchdb:5984` (CouchDB direkt)
- Credentials: `/home/hetzner/second-brain/.cloudflared/c4f03ae1-...json`
- Config: `/home/hetzner/second-brain/.cloudflared/config.yml`
- Für Stage 4: Pfad `/mcp` muss auf den MCP-Server geroutet werden (Pfad-Routing in config.yml ergänzen)

### LiveSync-Sync ✅ (Stage 2, Mac + Android)

- **Mac:** Vault `~/vault` (68 .md-Dateien), LiveSync-Plugin verbunden, E2E aktiv
- **Android:** Vault „NotesVault", alle 68 Notizen synchronisiert
- **iPad:** noch nicht eingerichtet (gleiche Schritte wie Android — HUMAN-STEP)
- E2E-Verschlüsselung: **AN**, Obfuscate Properties: **AUS** (wichtig — die Bridge braucht lesbare Pfade)
- Syncthing: auf Server und Mac gestoppt/entfernt (nicht mehr benötigt)

### Lokaler Mac-Vault

- Pfad: `~/vault`
- `.stignore` vorhanden (`.obsidian/workspace*` und Konflikt-Dateien ausgeschlossen)

---

## 3. Was noch zu bauen ist

### Stage 2 (Rest): iPad ✅

Erledigt. LiveSync auf iPad verbunden, alle 68 Notizen synchronisiert.
Wichtig für künftige Neueinrichtungen: bei leerem Gerät NICHT „Overwrite Server" wählen,
sondern „Reset Synchronisation on This Device" → Schedule and Restart (zieht vom Server).

### Stage 3: Vault-Konvention — laufende Nutzeraufgabe

Konventions-Notiz `_KONVENTIONEN.md` im Vault anlegen mit Frontmatter-Schema:

```yaml
---
type:        # note | project | area | resource | person | log
status:      # active | done  (optional)
tags:        []
related_to:  []   # [[Wikilinks]] zu verbundenen Notizen
---
```

**Definition of Done:** Ein gutes Dutzend Notizen mit `[[Links]]`; Obsidians Graph-Ansicht zeigt Verbindungen.

### Stage 4: Brücke + MCP-Server — NÄCHSTER BAUSCHRITT

#### 4a. Brücke (CouchDB ↔ vault-mirror/)

Spiegel-Ziel: `/home/hetzner/second-brain/vault-mirror/`

Kandidaten — vor dem Bauen evaluieren:

- **`vrtmrz/livesync-bridge`** — offizieller Companion des LiveSync-Autors; bridged LiveSync ↔ Dateisystem/Storage
- **`fanselau/obsidian-vault-cli`** — gebaut für LiveSync + Agenten-Zugriff auf derselben Maschine

Die Brücke braucht `LIVESYNC_PASSPHRASE` aus `.env` zum Ent-/Verschlüsseln.
Obfuscate Properties ist AUS → Dateipfade sind im CouchDB-Dokument lesbar → Bridge-Implementierung einfacher.

#### 4b. MCP-Server

- Werkzeuge: `note_create`, `note_read`, `note_update`, `note_search`
- Liest/schreibt nur `vault-mirror/`, nie direkt CouchDB
- Tunnel-Pfad: `brain.canimagin.com/mcp` (Pfad-Routing in `.cloudflared/config.yml` ergänzen)
- Auth: Bearer-Token (`MCP_BEARER_TOKEN` aus `.env`)

**KRITISCH — Lektion aus dem Parfüm-Projekt:**
claude.ai Custom Connector erwartet OAuth, kein einfaches Bearer-Token.
„couldn't register with sign-in service" ist der Fehler bei authless Servern.
→ OAuth als Modul implementieren (Code ist wiederverwendbar, Instanzen bleiben getrennt).

**Latenz-Lehre (aus Parfüm-Projekt) — Tools grobkörnig bauen:**

- `note_search` → nur Treffer-Schnipsel + Pfade, nicht ganze Dateien
- `note_upsert` → eine Notiz in einem Aufruf ändern, nicht feldweise
- Kleine Payloads; serverseitig filtern

#### 4c. Tunnel-Routing erweitern

```yaml
# .cloudflared/config.yml — aktuell:
ingress:
  - hostname: brain.canimagin.com
    service: http://couchdb:5984
  - service: http_status:404

# Nach Stage 4 ergänzen:
ingress:
  - hostname: brain.canimagin.com
    path: /mcp
    service: http://mcp:8080
  - hostname: brain.canimagin.com
    service: http://couchdb:5984
  - service: http_status:404
```

**Definition of Done Stage 4:** Über claude.ai eine Notiz aufnehmen → erscheint in `vault-mirror/`,
wandert über die Brücke in CouchDB, erscheint auf Mac + Android in Obsidian; Claude findet eine
bestehende Notiz per Suche; Erfassen dauert Sekunden.

### Stage 5: Graph-Schicht (FalkorDB + Indexer)

- FalkorDB als Docker-Dienst (Volume getrennt von vault-mirror/)
- Indexer: überwacht `vault-mirror/` per Datei-Watcher, parst Frontmatter + `[[Wikilinks]]`, upsert in FalkorDB
- MCP erweitern: `graph_related(note)`, `graph_traverse(topic)`
- Optionaler Ausbau: Graphiti als Engine

**Definition of Done Stage 5:** Eine Frage, deren Antwort über mehrere verknüpfte Notizen verteilt
liegt, wird vollständig beantwortet.

---

## 4. Server-Referenz

```bash
# SSH
ssh hetzner

# Projektverzeichnis
cd /home/hetzner/second-brain

# Status
docker ps

# CouchDB prüfen (lokal, Passwort aus .env lesen)
python3 -c "
import urllib.request, json, base64
pw = [l.split('=',1)[1].strip() for l in open('.env').read().splitlines() if l.startswith('COUCHDB_PASSWORD')][0]
creds = base64.b64encode(f'admin:{pw}'.encode()).decode()
req = urllib.request.Request('http://localhost:5984/secondbrain', headers={'Authorization': f'Basic {creds}'})
print(json.loads(urllib.request.urlopen(req).read()))
"

# Via Tunnel prüfen (von außen)
curl -s https://brain.canimagin.com/

# Logs
docker logs brain-couchdb
docker logs brain-cloudflared

# Secrets lesen
cat /home/hetzner/second-brain/.env
```

---

## 5. Sicherheits-Leitplanken (immer gültig)

- **CouchDB nie roh ins Internet** — Port 5984 nur lokal + Tunnel
- **E2E-Passphrase** und alle Tokens nie in git committen (`.env` in `.gitignore`)
- FalkorDB nicht öffentlich exponieren
- MCP nur über HTTPS + OAuth/Bearer-Token
- Sync ist kein Backup: CouchDB regelmäßig sichern

---

## 6. Bekannte Stolpersteine

- **OAuth für claude.ai:** Custom Connector scheitert bei authless Servern. OAuth-Modul muss vor oder
  parallel zu Stage 4 implementiert werden. Verweis auf Lösung im Parfüm-Projekt (`canimagin.com`).
- **Brücken-Tool:** Noch nicht evaluiert. `livesync-bridge` vs `obsidian-vault-cli` — testen, welches
  bidirektional mit E2E zuverlässig läuft.
- **Obfuscate Properties AUS halten** — wenn das je aktiviert wird, muss die Bridge angepasst werden.
