# Einmaliger Link-Backfill der ~150 Notizen

Eigenständige Aufgabe. **Nicht** Teil des laufenden Stage-Flows oder der CLAUDE.md — als
separater Schritt ausführen, **nachdem** Stage 4 steht (Brücke + MCP funktionieren und der
`vault-mirror/` mit lesbaren `.md` gefüllt ist).

## Ziel
Alle bestehenden ~150 Notizen einmalig mit sinnvollen `[[Wikilinks]]` versehen, damit der Graph
von Anfang an die echten Verknüpfungen abbildet. Danach läuft Verlinkung inkrementell pro neuer
oder geänderter Notiz und dieser Backfill ist nie wieder nötig.

## Wie ausführen — als Batch über Claude Code, NICHT über claude.ai-Chat
Der claude.ai-Chat ist für diese Aufgabe das falsche Werkzeug: 150 Notizen sprengen das
Konversationslimit, die Latenz pro Notiz summiert sich, und es erfordert ständiges Nachfassen.
Claude Code hat direkten Dateizugriff auf den `vault-mirror/`, läuft unbeaufsichtigt und ist nicht
ans Chat-Limit gebunden. Daher: lokal als Batch.

## Schritte
1. **Index bauen.** Einmal über alle Notizen gehen und eine Karte der verlinkbaren Ziele erzeugen:
   pro Notiz Titel + eine Ein-Zeilen-Beschreibung. Diese Karte ist die Grundlage für jede
   Verlinkungsentscheidung — ohne sie werden Links erfunden oder offensichtliche übersehen.
2. **Notizweise verlinken.** Für jede Notiz: Inhalt lesen, anhand des Index die passenden
   Zielnotizen bestimmen, die `[[Links]]` (und/oder `related_to` im Frontmatter) ergänzen,
   zurückschreiben.
3. Auf dem `vault-mirror/` arbeiten; die Brücke propagiert die Änderungen nach CouchDB und auf
   alle Geräte.

## Leitplanken
- **Nur auf existierende Notizen verlinken** (Index als Whitelist nutzen). Keine erfundenen Ziele.
- **Falsche Kante ist schlimmer als fehlende.** Im Zweifel keinen Link setzen.
- So umsetzen, dass danach ein **Review** möglich ist (z. B. Liste der gesetzten Links pro Notiz
  ausgeben). Verifikation visuell über Obsidians Graph-Ansicht.
- Für den Verlinkungs-Pass darf ein schnelleres Modell genutzt werden, um Zeit/Kosten zu sparen.

## Erwartung
- Laufzeit: grob 30–90 Minuten unbeaufsichtigt, je nach Notizlänge und Modell.
- Die erste Runde erzeugt einige falsche/überflüssige Kanten — das ist normal und wird im Review
  bereinigt.
- Einmaliger Aufwand; danach inkrementell.

## Definition of Done
Alle Notizen wurden verarbeitet; gesetzte Links zeigen nur auf existierende Notizen; eine
Übersicht der Änderungen liegt zum Review vor; Obsidians Graph-Ansicht zeigt ein sinnvoll
vernetztes Bild statt isolierter Knoten.
