# Chinaslop Tracker

A local dashboard for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, and Arknights: Endfield. It polls read-only HoYoLAB and SKPORT game data, keeps dated snapshots on this computer, and shows available daily and weekly progress.

## Export contents

This export contains the app source, tests, game icons, and 32 Endfield background images. It excludes saved account credentials, local configuration, and personal history. Browser appearance preferences and uploaded images stay in the original browser and are not included.

## Start

Install Node.js 20 or newer if needed, then extract this ZIP. On macOS, double-click `launch.command`; on Windows, double-click `launch.bat`. Or run `node server.mjs` in this folder. Close any other running copy using port 4317 first. Open the local address printed in the terminal (default: `http://127.0.0.1:4317`). Keep the terminal running for automatic refreshes. The app uses Node.js built-in modules and needs no package install.

When the dashboard opens, set an encryption password. Enter it again each time you restart the tracker. In Settings, expand the two **How to get** guides, then paste your own HoYoLAB session cookie and SKPORT account token. The app encrypts both values in `secrets.enc.json` using scrypt and AES-256-GCM. The encryption password is kept only in memory while the tracker runs. `config.local.json` holds only non-secret settings after migration. Both files have user-only permissions. The app binds to `127.0.0.1`; it does not send credentials to any service other than HoYoLAB and SKPORT.

The Settings guides explain how to copy the HoYoLAB cookie values and SKPORT account token manually from your signed-in browser session. Paste only the `ltoken_v2` value into **HoYoLAB token value** and the `ltuid_v2` value into **HoYoLAB account ID value**; the tracker formats the cookie line automatically. The account ID is different from an in-game UID. It is encrypted with the token, cleared from the form after saving, and never returned by the settings API. Leave either field blank to keep its saved value. Existing full cookie lines are also accepted. Clear your clipboard afterward.

Choose an automatic refresh interval in Settings: 5, 10, 30, or 60 minutes; 2, 4, or 8 hours; or **Custom** for a whole number of minutes from 1 to 1,440. Select **Save and sync** to apply it. A countdown beside the refresh button shows the next automatic refresh. It pauses while storage is locked or no account is connected. Clicking **Refresh now** or saving a new interval restarts the countdown using the saved interval.

If the tracker already has a plain-text config, setting the encryption password migrates the saved values and removes them from the current config file after verifying the encrypted copy. Older backups or filesystem snapshots may still contain the old file. Keep the password safe: losing it means you must remove the encrypted file and reconnect the accounts. Never send the cookie, token, or password to another person.

You can leave either service unconfigured. For HoYoLAB, the account ID is detected from `ltuid_v2` or `ltuid` in existing cookies. Older account IDs in `config.local.json` move into encrypted storage at the next unlock. The same HoYoLAB account must have the three game roles linked. For SKPORT, use a current account token associated with your Endfield role. The tracker does not ask for account passwords or perform sign-ins.

## What it tracks

- Genshin: daily commissions, reward claim, Original Resin, and weekly Trounce Domain discount uses where returned.
- Star Rail: daily training where returned, Trailblaze Power, and Simulated/Divergent Universe weekly points where returned.
- ZZZ: Battery Charge, daily activity, Bounty Commissions and Ridu Weekly progress where returned.
- Endfield: daily activity, Sanity, and weekly routine points.

Resource cards include a live **Full in** countdown for Resin, Trailblaze Power, Battery Charge and Sanity. Each countdown uses the API's recovery duration or full-recovery timestamp from the latest sync. Full resources show **Full**; after a predicted deadline they show **Full (estimated)** until the next sync confirms the amount. Spending or restoring a resource in-game changes its deadline at the next sync. Missing recovery fields show **Full time unavailable**.

Daily cards also show a **Daily reset in** timer based on the linked account's server region. Resets are at 04:00 server time: HoYoLAB America uses UTC−5, Europe UTC+1, and Asia/TW/HK/MO/China UTC+8. Endfield Asia uses UTC+8, while its combined Americas/Europe server uses UTC−5. The timers update every minute and roll over automatically; they do not change with your computer's local daylight saving time. Unknown server regions show **Daily reset: server unavailable**.

Weekly cards show **Weekly reset in**, counting down to Monday at 04:00 in the same server time zone. This is the regular weekly task reset; individual events and challenge seasons can have separate schedules. The timer rolls forward by one week at reset.

The live HoYoLAB ZZZ notes response checked on October 16, 2026 included normal Battery Charge but no reserved/backup battery field. Reserved battery cannot currently be tracked automatically through this response.

Unavailable fields show **Not exposed** or a service error. They are never counted as incomplete. The latest snapshot for each day and each week is used for the history view. The week is grouped by local Monday; in-game resets follow each game's server clock, so a snapshot near reset can straddle two displayed weeks.

HoYoLAB and SKPORT game data endpoints are used by their own apps but are not published as stable public developer APIs. Their response fields, authentication, or rate limits may change. This app keeps each connector isolated so it can be updated if needed. 

## Events

Open the Events tab for a horizontal event timeline. Select a game and server, then use Show to filter Events, Banners, or Challenges. These choices are remembered in this browser. Rows are sorted by earliest ending first. The date axis uses the selected server timezone and includes a Now marker. Scroll sideways or use earlier/later/Today controls to navigate. Select an event bar for its full artwork, exact dates and official source links. Countdowns update every minute; calendars are cached for 15 minutes, with one minute between retries after a failure. Upcoming and expired entries are hidden. Entries without a confirmed end date are excluded.

Choose a server separately for each game, or use My account server. Choices are remembered in this browser and only affect the Events page. Genshin, HSR and ZZZ use HoYoLAB calendars and require unlocked credentials. Viewing another HoYoLAB server requires a linked character on that server. Endfield uses the public official English GRYPHLINE notices at https://endfield.gryphline.com/en-us/news and the website's web-news.gryphline.com feed. No account credentials are sent to the news service. Server-local dates use Asia UTC+8 or Americas/Europe UTC-5. Only schedules with readable, confirmed start and end times are shown; entries ending at an unspecified future maintenance are excluded. Coverage depends on the notices and may omit events with unsupported date formats. Each Endfield event links to its official notice. Errors and stale results are labeled per game.

Timeline bars sample a dominant color from each thumbnail and choose contrasting text. Official thumbnails load through a local, allowlisted image endpoint so browser pixel sampling works. Image bytes are cached in memory (up to 8 MB) and by the browser for one hour; sampled colors are reused while the page is open. Missing or unreadable thumbnails use fallback bar colors.

HoYoLAB coverage includes Genshin's character, weapon and Chronicled Wish banners and fixed challenge calendar; HSR's character and Light Cone banners and challenge cycles; and ZZZ's gacha calendar plus Deadly Assault, Threshold Simulation, Shiyu Defense and Annihilation Simulacrum feeds. Optional ZZZ feed failures are labeled and do not hide other events. Challenge dates must be reported by the official service; cycles are not guessed from hardcoded reset anchors. Endfield banners and challenge seasons continue to come from official English notices with confirmed dates.

Artwork is discovered automatically from HoYoLAB announcement feeds (including older posts), HSR's current official homepage, and Endfield's latest official version guide. Website configuration and image URLs are cached in memory for 15 minutes. No patch-specific image URL list is required. If a source has no matching image or changes its page structure, the event remains visible without artwork; the lookup never changes its dates.

After updating an existing installation, restart the Node server to enable the new `/api/events` endpoint.

## Daily check-in

Unlock storage, then select **Check in** in the header to claim today's HoYoLAB rewards for Genshin, HSR, and ZZZ and SKPORT rewards for your linked Endfield role. The result dialog shows each game's outcome. Already completed check-ins are skipped. The button does not claim in-game commissions. In Settings → Accounts → Daily check-in, you can enable automatic daily check-in. It checks immediately when enabled or unlocked, then once an hour using the providers’ own daily status, so completed rewards are skipped. The server must remain running and unlocked; after shutdown or sleep it resumes when available. Expired sessions and CAPTCHA challenges require your attention. Automatic check-in is off by default.

The local server sends your saved credentials directly to the corresponding official service. Expired sessions must be updated in Settings. If HoYoLAB requests verification, use the official check-in link in the result dialog. The tracker does not bypass CAPTCHAs.

Endpoint references: https://github.com/sglkc/hoyolab-auto-daily and https://github.com/sglkc/endfield-auto-daily . These are unofficial client implementations of the official services.

## Settings and appearance

Settings has Accounts, Appearance, and Security sections. Appearance supports built-in Endfield backgrounds, your own JPG/PNG/WebP image, automatic image-matched palettes, manual palettes, and an image overlay. Select Save appearance to persist choices in the current browser. Game cards are slightly translucent over images. Security lets you change the encryption password.

History is a separate page with independent daily and weekly pagination. Desktop defaults are 10 daily entries and 3 weekly entries; mobile defaults to one entry each.

## Verification

Run `npm test` or `node --test` from the extracted project folder to run the included tests. No package installation is required.
