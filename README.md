# Open World Apocalypse

A top-down survival game set in Shibuya, Tokyo. Windows desktop app built with Electron.

## Playing

Download `Open-World-Apocalypse-Setup-x.y.z.exe` from the **Releases** page and run it. Windows may show
"Windows protected your PC" because the app isn't code-signed: click **More info → Run anyway**.

After that, the game updates itself: **Settings → Updates → Download update → Restart and update**.
A notice also appears on the main menu when a new version is out.

## Where saves live

`%APPDATA%\Open World Apocalypse\saves\` — outside the install folder, so updating or reinstalling never
touches them. Each save file keeps a `.bak` copy of the previous version.

**Moving a save between the web version and the desktop app:** Settings → Save transfer → Export save
(copies a code) in one, then Settings → Save transfer → Import save in the other.

## Free local AI (optional)

Settings → Free local AI installs [Ollama](https://ollama.com) and downloads the `llama3.2:3b` model
(about 2 GB). Characters then answer anything you type. Without it, the built-in conversation system is
used, which needs no download and no account.

## Releasing an update

1. Copy the new game file to `game/index.html`.
2. Bump `"version"` in `package.json` (for example `0.5.1`).
3. Commit and push to `main`. Changing the version in `package.json` starts the build.

The **Build and release** workflow builds the Windows installer on GitHub's servers and publishes it as a
release. Installed copies of the game see it the next time they check for updates.
