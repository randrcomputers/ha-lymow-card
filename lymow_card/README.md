# Lymow card artwork

Copy this entire folder to Home Assistant:

`config/www/lymow_card/`

## Card images

| File | Card setting | When shown |
| --- | --- | --- |
| `lymow_docked.png` | **Dock image URL** (`image_dock`) | Docked, charging, idle |
| `lymow_dock_empty.png` | **Mower image URL** (`image_mower`) | Mowing, returning, paused (robot away) |
| `lymow_mower_cutout.png` | Optional | Transparent product cutout (not used by default) |

These assets use **transparent backgrounds** so they blend with any Home Assistant theme (light or dark). A soft drop shadow keeps the dock readable on the card.

| File | Card setting | When shown |
| --- | --- | --- |
| `lymow_docked.png` | **Dock image URL** (`image_dock`) | Docked, charging, idle |
| `lymow_dock_empty.png` | **Mower image URL** (`image_mower`) | Mowing, returning, paused (robot away) |

No grass, fence, or outdoor scene — generic product cutouts only.

## Default YAML

```yaml
type: custom:lymow-card
device: YOUR_DEVICE_ID
image_dock: /local/lymow_card/lymow_docked.png
image_mower: /local/lymow_card/lymow_dock_empty.png
hero_mode: art
show_map: true
```

Use `hero_mode: auto` if you prefer the integration **Map** camera while the robot is active.

## Rebuild from sources

If you replace the reference photos, rerun:

```bash
python tools/build_card_images.py
```

The empty-dock hero (`lymow_dock_empty.png`) may also be regenerated with AI from the same references.
