# Klangraum – privater Spotify-Client (Experiment)

Ein eigener Spotify-Client, der komplett im Browser läuft: reines HTML/CSS/JS, kein Build-Schritt, kein Server-Backend, kein Client Secret.

## Starten

1. Doppelklick auf `start.bat` (braucht Python). Alternativ:
   ```
   python -m http.server 8888 --bind 127.0.0.1
   ```
2. Öffne **http://127.0.0.1:8888/**. Nimm `127.0.0.1`, nicht `localhost`, sonst passt die Redirect URI nicht.

## Einmalige Einrichtung bei Spotify

1. https://developer.spotify.com/dashboard → **Create app**
2. Redirect URI: `http://127.0.0.1:8888/`
3. APIs: **Web API** und **Web Playback SDK** anhaken
4. Die **Client ID** in Klangraum einfügen → „Mit Spotify verbinden“

## Auf dem iPhone

Spotify erlaubt auf dem Handy kein Abspielen im Browser. Auf dem iPhone ist Klangraum deshalb eine
**Fernbedienung**: Die Musik läuft in der offiziellen Spotify-App (oder auf PC/Lautsprecher),
Klangraum steuert sie über Spotify Connect.

1. Klangraum muss per **HTTPS** erreichbar sein (z. B. GitHub Pages). `127.0.0.1` gibt es auf dem iPhone nicht.
2. Im Spotify-Dashboard die gehostete Adresse als **zusätzliche** Redirect URI eintragen, z. B. `https://DEINNAME.github.io/klangraum/` (mit `/` am Ende).
3. Optional die Client ID in `js/config.js` eintragen, dann entfällt das Eintippen auf dem Handy.
4. Auf dem iPhone in **Safari** öffnen → Teilen → **Zum Home-Bildschirm**. Danach startet Klangraum wie eine App, ohne Browserleiste.
5. Wenn „Kein Gerät gefunden“ erscheint: Lautsprecher-Symbol → **Spotify-App öffnen**, kurz warten, zurückwechseln.

Tippe auf die Mini-Leiste unten, um den Vollbild-Player „Jetzt läuft“ zu öffnen. Nach unten wischen schließt ihn.

## Was geht

- Login per OAuth PKCE, Token erneuert sich automatisch
- Abspielen direkt im Browser (Web Playback SDK) **oder** andere Geräte fernsteuern (Spotify Connect)
- Start: Zuletzt gehört, Top-Songs, Top-Künstler, Playlists
- Suche (Songs, Künstler, Alben, Playlists) mit letzten Suchen
- Bibliothek: Playlists, Alben, gefolgte Künstler, Lieblingssongs (endloses Nachladen)
- Playlist-, Album- und Künstlerseiten mit Farbverlauf aus dem Cover
- Player: Play/Pause, Vor/Zurück, Spulen, Lautstärke, Zufall, Wiederholen, Warteschlange, Geräteauswahl, Herz
- Tastatur: `Leertaste` Play/Pause · `Shift + ←/→` Song zurück/weiter · `/` Suche
- Medientasten und Sperrbildschirm über die Media Session API
- Handy-Layout mit unterer Navigation

## Grenzen (Spotify-Regeln, Stand 2026)

- Der Besitzer der Developer-App braucht **Spotify Premium**. Höchstens **5 Accounts** pro App im Development Mode (weitere unter *User Management* eintragen).
- Abspielen im Browser braucht Premium und DRM (Widevine): Chrome, Edge oder Firefox funktionieren. Eingebettete Browser oft nicht.
- Songlisten gibt es nur für Playlists, die dir gehören oder an denen du mitarbeitest. Fremde Playlists lassen sich trotzdem abspielen.
- `Top-Tracks eines Künstlers`, `Neuerscheinungen`, Kategorien und Empfehlungen sind für neue Apps gesperrt. Die Künstlerseite holt Songs deshalb über die Suche.
- Suche: höchstens 10 Treffer pro Typ.

## Dateien

```
index.html        Einstieg
css/style.css     Aussehen (Desktop + Handy)
js/auth.js        PKCE-Login, Token-Refresh
js/api.js         Web-API-Hülle, Bibliothek, Track-Normalisierung
js/player.js      Web Playback SDK + Connect-Steuerung, Zustand
js/views.js       Alle Seiten (Start, Suche, Bibliothek, Playlist, Album, Künstler, Warteschlange)
js/main.js        App-Shell, Router, Player-Leiste, Setup-Bildschirm
```

Alle Daten (Client ID, Tokens) bleiben im `localStorage` deines Browsers.
