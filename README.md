# Ferry Port: Island Hop (prototype)

An arcade idle prototype. You run a ferry port in a coastal American town: sell tickets, load parcels onto the ferry, unload the lobsters it brings back, and sell them at the seafood stand.
Design: `../riset-gameplay/DESAIN-PELABUHAN-FERI.md`.

## Running it
```bash
cd ferry-port
npm install      # first time only
npm run dev      # open the URL it prints (e.g. http://localhost:5173)
```
Build for sharing: `npm run build` (output in `dist/`, can be hosted as static files).

## Controls
- **Mouse/touch:** press and drag anywhere (floating joystick).
- **Keyboard:** WASD / arrow keys.
- Every interaction happens automatically when you stand in a zone or on a price tile.

## Debug
Press the ⚙️ button (or the `` ` `` key): game speed x1/x2/x4, +$500, +5 stars, force the ferry to depart, restart.

## Contents (milestone 1)
- Ticket booth + barrier, car queue (sedan, pickup, motorcycle, VIP RV x3).
- Ferry: deck slots you can see, departure timer, "SHIP FULL!" bonus, sails to the island and comes back with lobsters and cars.
- Cargo shed → parcels → ferry cargo area.
- Seafood stand (lobsters) and Lobster Shack (2 lobsters → lobster roll).
- Workers: clerk, dockhand, unloader.
- Upgrades: carry capacity, speed, bigger ferry (2 tiers), stand upgrade.
- Levels from stars (level-locked tiles), objectives + guide arrow.
- Events: seagull thief (chase it away), VIP RV.
- Juice: squash/stretch, confetti, dust, splashes, ship wake, funnel smoke, floating text, camera shake, vibration (mobile).
- SFX and music are generated with Web Audio (no audio files).
- Ending: the "Apple Orchard Isle" tile shows a summary card.

## Tuning
All the numbers (prices, speeds, ferry times, level thresholds) are in `src/config.ts`.

## Files
- `src/main.ts`: renderer, camera, input, loop.
- `src/game.ts`: all game logic.
- `src/parts.ts`: carried stack, piles, cash, price tiles.
- `src/models.ts`: low-poly 3D models (built in code).
- `src/world.ts`: environment + layout positions.
- `src/fx.ts`: particles, world-space labels, camera shake.
- `src/audio.ts`: procedural SFX + music.
