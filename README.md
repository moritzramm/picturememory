# picturememory

Remember stuff with images – Bild-Karteikarten als reine Browser-App.

Rein statische Web-App: Bilder beschreiben und als Karteikarten lernen.
Alle Bilder und Beschreibungen bleiben im Browser des jeweiligen Geräts (IndexedDB). Es gibt keinen Server und kein Tracking, nichts wird hochgeladen.

## Veröffentlichen auf GitHub Pages

1. Inhalt dieses Ordners in ein (öffentliches) GitHub-Repository legen, z. B. `picturememory`.
2. Im Repo: *Settings → Pages → Build and deployment → Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
3. Nach ca. 1 Minute erreichbar unter `https://<benutzername>.github.io/picturememory/`.

Lokal testen: `python3 -m http.server 8123` in diesem Ordner, dann http://localhost:8123 öffnen.

## Bedienung

- **Beschreiben:** „Ordner wählen“ (Desktop) oder „Bilder wählen“ (auch iPhone/iPad). Erneutes Wählen desselben
  Ordners fragt nur neue Bilder ab. Erkennung über Dateiname + Dateigröße. Große Fotos werden beim Import auf
  max. 2048 px verkleinert.
- **Lernen:** zufällige Reihenfolge, Aufdecken/Weiter per Button, Leertaste oder Tippen aufs Bild.
- **Karten:** Liste mit Suche, Bearbeiten, Löschen (optional „bei künftigen Importen ignorieren“).
- **Daten:** Speicherbelegung, dauerhaften Speicher anfragen, Sicherung exportieren/importieren, alles löschen.

## Wichtig zur Datenhaltung

- Jedes Gerät und jeder Browser hat einen eigenen Datenbestand. Übertragen geht über Export/Import.
- Daten gehen verloren beim Löschen der Websitedaten, im privaten Modus, und in Safari nach 7 Tagen ohne Nutzung,
  wenn die App nicht zum Home-Bildschirm/Dock hinzugefügt wurde. Regelmäßig exportieren.
- Alle GitHub-Pages-Projekte unter `<benutzername>.github.io` teilen sich denselben Browser-Speicherbereich (gleiche
  Origin). Dort keine fremden/unvertrauenswürdigen Projekte hosten oder eine eigene Domain verwenden.

## Technik

Web Awesome 3.14 (Dark Mode) über jsDelivr-CDN, Icons über Font Awesome Free. Service Worker cacht App und CDN-Dateien,
die App funktioniert nach dem ersten Aufruf auch offline.
