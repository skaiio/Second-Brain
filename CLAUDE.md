# Second Brain — Projektkontext für Claude Code

## Was ist das?

Obsidian-Vault auf Mac/iPad/Android, synchronisiert via Self-hosted LiveSync → CouchDB auf Hetzner.
Eine Brücke materialisiert CouchDB ↔ `vault-mirror/` als .md-Dateien.
Ein MCP-Server gibt Claude Werkzeuge, um Notizen zu lesen und zu schreiben.

## Architektur

```
Obsidian (Mac/Android/iPad)
        ↕ LiveSync (E2E-verschlüsselt)
    CouchDB  ←→  livesync-bridge  →  vault-mirror/ (.md-Dateien)
                                          ↕
                                     MCP-Server (Port 8080)
                                          ↓
                                    claude.ai Connector
                                    https://brain.canimagin.com/mcp
```

## Quelle der Wahrheit

**Lokal ist Source of Truth. Der Server ist nur Deploy-Ziel.**

- Lokal entwickeln → committen → auf Server deployen
- Kein direktes Editieren auf dem Server (Ausnahme: Notfall-Hotfix, danach sofort zurückholen)
- Secrets (`.env`) NUR auf dem Server — niemals committen
- Daten (`couchdb-data/`, `vault-mirror/`, FalkorDB) bleiben auf dem Server — nie in Git

## Server

| | |
|---|---|
| VPS | Hetzner CXP22, Ubuntu 24.04, IP `178.104.38.178` |
| SSH | `ssh hetzner` |
| Projektverzeichnis | `/home/hetzner/second-brain/` |
| Tunnel | `brain.canimagin.com` → CouchDB; `/mcp` → MCP-Server |

## Deploy-Workflow

```bash
# 1. Lokal entwickeln und committen
git add -p && git commit -m "..."
git push

# 2. Auf dem Server deployen
ssh hetzner "cd /home/hetzner/second-brain && git pull && docker compose up -d --build"

# 3. Secrets auf dem Server setzen (einmalig / bei Änderung)
# Datei /home/hetzner/second-brain/.env manuell bearbeiten
```

## Secrets (.env auf dem Server)

```
COUCHDB_PASSWORD=<stark>
LIVESYNC_PASSPHRASE=<stark>    # Bridge braucht das zum Entschlüsseln
MCP_BEARER_TOKEN=<stark>       # OAuth-Admin-Passwort + API-Key
```

## Erste Einrichtung auf neuem Server

1. `.env` anlegen (Werte aus Passwort-Manager)
2. `couchdb-config/docker.ini` aus Template generieren:
   `sed "s/CHANGE_ME/$COUCHDB_PASSWORD/" couchdb-config/docker.ini.template > couchdb-config/docker.ini`
3. `bridge/dat/config.json` aus Template generieren (Skript: `make gen-config`)
4. `docker compose up -d --build`

## Services (docker-compose)

| Service | Image | Port (intern) | Zweck |
|---|---|---|---|
| `couchdb` | `couchdb:3` | `127.0.0.1:5984` | Obsidian-Datenbank |
| `cloudflared` | `cloudflare/cloudflared` | — | Tunnel |
| `bridge` | lokal gebaut | — | CouchDB ↔ vault-mirror/ |
| `mcp` | lokal gebaut | `8080` | MCP-Server für claude.ai |

## Definition of Done je Stage

### Stage 1 ✅
CouchDB läuft, von außen über `https://brain.canimagin.com` erreichbar.

### Stage 2 ✅
LiveSync auf Mac + Android + iPad verbunden, 68+ Notizen synchronisiert.

### Stage 3 (laufend)
`_KONVENTIONEN.md` im Vault, Dutzend Notizen mit `[[Links]]`.

### Stage 4
Prüfung: Notiz auf Mac schreiben → erscheint als entschlüsselte .md in `vault-mirror/` →
Claude kann sie per `note_search` finden und per `note_upsert` eine neue anlegen →
neue Notiz erscheint in Obsidian auf Mac und Android.

### Stage 5
Graph-Schicht: FalkorDB + Indexer, `graph_related`/`graph_traverse` im MCP.

## Sicherheits-Leitplanken

- CouchDB nie roh ins Internet (Port 5984 nur lokal + Tunnel)
- E2E-Passphrase und alle Tokens nie in Git
- MCP nur über HTTPS + OAuth 2.1 (Cloudflare Tunnel → TLS)
- CORS: kein Wildcard wenn Credentials im Spiel
- FalkorDB nicht öffentlich exponieren

## Bekannte Stolpersteine

- **OAuth für claude.ai:** Custom Connector erwartet OAuth 2.1 + PKCE (S256).
  claude.ai probiert VIER verschiedene Discovery-URLs — alle müssen beantwortet werden:
  1. `GET /mcp/.well-known/oauth-protected-resource` (RFC 9728, Protected Resource)
  2. `GET /.well-known/oauth-authorization-server/mcp` (RFC 8414, Pfad-basiert)
  3. `GET /.well-known/openid-configuration/mcp` (OIDC, Pfad-basiert)
  4. `GET /mcp/.well-known/openid-configuration` (OIDC unter dem Prefix)
  Wenn auch nur eine davon fehlt → "Couldn't register with sign-in service" — kein Login-Tab.
  Callback-URL ist fix: `https://claude.ai/api/mcp/auth_callback`

- **livesync-bridge:** Passwörter im Config plaintext (kein env-var-Substitut).
  Deshalb: Template in Git, generierte config.json in .gitignore.
  Beim Build `--recurse-submodules` nötig (lib/ ist Submodul).

- **Obfuscate Properties: AUS** — wenn das je aktiviert wird, muss die Bridge angepasst werden.
