SITELINE GAME SERVER — WINDOWS SETUP
====================================

(On ZimaOS? Use ZIMAOS.txt instead: it's a ready-made app.)
(On Ubuntu Linux? Use LINUX.txt instead: one script sets it all up,
including starting on boot and nightly updates.)

This folder is the game server. It runs on your Windows PC and hosts every
online match. It uses the game files one folder up (server.js, maps.js, ...),
so keep the whole repository together — don't copy this folder on its own. Your website stays on GitHub Pages; players' browsers connect
to this server to play. Tailscale Funnel gives it a secure public address
without changing your router settings.


1. INSTALL NODE.JS (once)
   - Go to https://nodejs.org/ and install the "LTS" version (accept the defaults).

2. GET THE FILES
   - On https://github.com/sitev2/siteline click the green "Code" button ->
     "Download ZIP". Unzip it somewhere permanent, e.g. C:\siteline
     (not in Downloads, so it doesn't get cleaned up).

3. START THE SERVER
   - Open the "server" folder and double-click start.bat. The first time, it
     installs one small library (needs internet). Then a black window says
     "SITELINE server listening on port 8787".
   - Leave that window open. Closing it stops the server.
   - Check it: open http://localhost:8787 in a browser on this PC.
     You should see "SITELINE server is running."

4. INSTALL TAILSCALE (once)
   - Download Tailscale for Windows from https://tailscale.com/download and sign in.

5. GIVE THE SERVER A PUBLIC SECURE ADDRESS (once)
   - Open Command Prompt (Start menu -> type "cmd" -> Enter) and run:

         tailscale funnel --bg 8787

   - If it prints a link asking you to enable HTTPS or Funnel, open the link,
     approve it, then run the same command again.
   - It prints your address, something like:
         https://gamebox.tail1234.ts.net
   - "--bg" keeps it running in the background, even after a restart.
   - To see the address again later:   tailscale funnel status
   - To turn it off:                    tailscale funnel --bg 8787 off

6. CHECK IT FROM OUTSIDE YOUR HOUSE
   - On your phone, turn Wi-Fi OFF (use mobile data) and open your
     https://....ts.net address. You should see "SITELINE server is running."

7. CONNECT THE GAME TO IT
   - Take your address and change https:// to wss://
         https://gamebox.tail1234.ts.net  ->  wss://gamebox.tail1234.ts.net
   - Try it first without changing anything:
         https://sitev2.github.io/siteline/?server=wss://gamebox.tail1234.ts.net
   - When it works, open config.js (in your website files) and set:
         serverUrl: params.get('server') || 'wss://gamebox.tail1234.ts.net',
     then upload config.js to GitHub and commit. From then on every online
     game goes through your server.


KEEP IT RUNNING
---------------
- Start with Windows: press Win+R, type  shell:startup  and press Enter.
  Right-click in that folder -> New -> Shortcut -> pick start.bat.
  (It starts when you sign in to Windows.)
- Stop the PC from sleeping: Settings -> System -> Power -> Screen and sleep
  -> set "When plugged in, put my device to sleep after" to Never.
- start.bat restarts the server automatically if it ever crashes.

GOOD TO KNOW
------------
- Only the game server (port 8787) is shared to the internet — not the rest
  of your PC or network.
- If the server or PC is off, nobody can play online. Practice range still works.
- One server handles many rooms at once (2v2, up to 4 players per room).
  Change limits with environment variables:  set MAX_ROOMS=50
- When the game is updated: download the ZIP again, unzip it over the old
  folder (replace files), then close and re-open start.bat. Your settings
  live in config.js, which is part of the download.
