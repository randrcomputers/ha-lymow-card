# Lymow Card

Lovelace card built for the **[Lymow-HA](https://github.com/d3dfantasy99/Lymow-HA)** integration — a tailored dashboard for **Lymow One Plus** and other Lymow mowers, with live map, battery, session progress, mow pattern control, and Lymow-branded styling.

Replaces generic cards like [compact-lawn-mower-card](https://github.com/Tra1n84/compact-lawn-mower-card) with entity wiring and UI specific to Lymow.

## Features

- **Lymow device picker** — auto-fills mower, status, battery, map camera, buttons, and more
- **Live map hero** — integration map camera while mowing / returning (refreshes on an interval)
- **Custom artwork** — transparent generic dock / empty-dock cutouts (no outdoor background)
- **Built-in silhouette** — Lymow-style SVG fallback when no images are configured
- **Battery + online** — compact header with charging state
- **Session progress bar** — uses `Session Progress` sensor during active runs
- **Stats row** — mowed area, blade height, RTK fix
- **Smart actions** — Start / Resume / Pause / Dock via `lawn_mower` services; Cancel task & Dock & cancel via integration buttons
- **Mow pattern** — dropdown wired to the integration **Mow Mode** select
- **Alert chips** — error, lifted, rain delay

## Install

1. Copy `lymow-card.js` to `config/www/` **or** add this repo in HACS → **Frontend** → **Custom repositories**
2. **Settings** → **Dashboards** → **Resources** → add `/local/lymow-card.js` (module)
3. Reload resources and hard-refresh the browser (**Ctrl+F5**)

### HACS custom repository

```
https://github.com/randrcomputers/ha-lymow-card
```

Category: **Lovelace**

## Quick start

Pick your **Lymow device** in the card editor (recommended):

```yaml
type: custom:lymow-card
device: YOUR_DEVICE_ID
```

Or YAML with manual entities:

```yaml
type: custom:lymow-card
entity_mower: lawn_mower.lymow_one_plus
entity_map: camera.lymow_one_plus_map
```

See `examples/dashboard-card.yaml` for a full snippet.

## Card options

| Option | Default | Description |
| --- | --- | --- |
| **Lymow device** | — | Auto-wires entities from [Lymow-HA](https://github.com/d3dfantasy99/Lymow-HA) |
| **Hero area layout** | `auto` | `auto` = map while active, art when docked; or force `map` / `art` |
| **Show map camera** | on | Uses integration **Map** camera in the hero area |
| **Show stats row** | on | Area, blade height, RTK |
| **Show mow pattern selector** | on | Integration **Mow Mode** select |
| **Show secondary actions** | on | Cancel task, Dock & cancel buttons |
| **Mower image URL** | empty dock | Shown while mowing (`lymow_dock_empty.png`) |
| **Dock image URL** | docked photo | Shown while docked/charging (`lymow_docked.png`) |
| **Map refresh interval** | 30 s | How often to refresh the map snapshot |

## Entity wiring (auto from device)

| Integration entity | Card use |
| --- | --- |
| Lawn mower | Start / Pause / Dock |
| Status | Status pill text |
| Battery | Header gauge |
| Session Progress | Progress bar |
| Session Mowed Area | Stats |
| Blade Height | Stats |
| RTK GPS | Stats |
| Map (camera) | Hero map |
| Mow Mode (select) | Pattern dropdown |
| Online | Cloud indicator |
| Error / Lifted / Rain delay | Alert chips |
| Cancel Task / Dock & Cancel | Secondary buttons |

## Optional artwork

Copy photos to `config/www/lymow_card/` and set URLs in the editor. Details in [`lymow_card/README.md`](lymow_card/README.md).

## Requirements

- Home Assistant **2024.1+**
- [Lymow-HA](https://github.com/d3dfantasy99/Lymow-HA) integration installed and configured

## Related

- [Lymow-HA integration](https://github.com/d3dfantasy99/Lymow-HA)
- [Pool Cleaner Card](../ha-pool-cleaner-card) — same card family for Maytronics Dolphin
