/**
 * Lymow Card — Home Assistant Lovelace (Lymow-HA integration).
 * Tailored dashboard card for Lymow One Plus and other Lymow mowers.
 * @version 29
 */
(function () {
  const LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
  const { html, css, nothing } = LitElement.prototype;

  const DEFAULTS = Object.freeze({
    /** Shown while mowing / away — empty dock (robot gone). */
    image_mower: "/local/lymow_card/lymow_dock_empty.png",
    /** Shown while docked / charging — robot on station. */
    image_dock: "/local/lymow_card/lymow_docked.png",
    hero_mode: "auto",
    show_map: true,
    show_stats: true,
    show_mow_mode: true,
    show_secondary_actions: true,
    show_zone_picker: true,
    show_headlights: true,
    map_refresh_seconds: 30,
    map_size: "auto",
    units: "metric",
  });

  const ENTITY_SUFFIXES = {
    mower: "_mower",
    status: "_work_status",
    battery: "_battery",
    progress: "_session_percent",
    area: "_session_area",
    map_area: "_map_area",
    blade: "_blade_height",
    rtk: "_rtk_status",
    map: "_map",
    map_geojson: "_map_geojson",
    mow_mode: "_clean_mode_select",
    online: "_online",
    mowing: "_mowing",
    charging: "_charging",
    error: "_error",
    lifted: "_lifted",
    rain: "_rain_delay",
    headlights: "_headlights",
    btn_cancel: "_btn_cancel_task",
    btn_dock_cancel: "_btn_dock_cancel",
    wifi: "_wifi_signal",
    lte: "_lte_signal",
    network: "_network_type",
  };

  /** unique_id suffixes and common HA entity_id slug variants (name-based slugs). */
  const ENTITY_SUFFIX_ALIASES = {
    rtk: ["_rtk_status", "_rtk_gps"],
    status: ["_work_status"],
    area: ["_session_area", "_session_mowed_area"],
    mow_mode: ["_clean_mode_select", "_mow_mode"],
  };

  const ENTITY_NAME_HINTS = {
    rtk: [/^rtk/i, /rtk gps/i],
    blade: [/blade height/i, /cut height/i],
    wifi: [/wifi signal/i],
    lte: [/4g signal/i, /lte signal/i],
    network: [/network type/i],
    area: [/session mowed area/i, /session area/i],
    map_area: [/map total area/i],
  };

  const ENTITY_DOMAINS = {
    mower: "lawn_mower",
    status: "sensor",
    battery: "sensor",
    progress: "sensor",
    area: "sensor",
    map_area: "sensor",
    blade: "sensor",
    rtk: "sensor",
    map: "camera",
    map_geojson: "sensor",
    mow_mode: "select",
    online: "binary_sensor",
    mowing: "binary_sensor",
    charging: "binary_sensor",
    error: "binary_sensor",
    lifted: "binary_sensor",
    rain: "binary_sensor",
    headlights: "switch",
    btn_cancel: "button",
    btn_dock_cancel: "button",
    wifi: "sensor",
    lte: "sensor",
    network: "sensor",
  };

  const ACTIVITY_LABELS = {
    mowing: "Mowing",
    docked: "Docked",
    paused: "Paused",
    returning: "Returning",
    error: "Error",
  };

  function normalizeMapSize(value) {
    const raw = String(value ?? DEFAULTS.map_size).trim().toLowerCase();
    if (raw === "compact" || raw === "large" || raw === "full") return raw;
    return "auto";
  }

  function resolveMapSize(cfg, activity, showShapePanel) {
    const mode = normalizeMapSize(cfg.map_size);
    if (mode !== "auto") return mode;
    if (isActiveRun(activity)) return showShapePanel ? "large" : "full";
    if (showShapePanel) return "compact";
    return "large";
  }

  /** When to show the side zone schematic and which zones to highlight. */
  function resolveShapePanelState(cfg, activity, selected, mowAll, mowingZones, mowingAll, zoneFeatures) {
    if (cfg.show_zone_picker === false || !zoneFeatures?.length) {
      return { show: false, highlight: new Set(), label: "" };
    }
    const picking = !isActiveRun(activity) && selected.size > 0;
    if (picking) {
      return {
        show: true,
        highlight: selected,
        label: selected.size === 1 ? "1 zone" : `${selected.size} zones`,
      };
    }
    if (!isActiveRun(activity)) {
      return { show: false, highlight: new Set(), label: "" };
    }
    if (mowingAll) {
      const all = new Set(zoneFeatures.map((z) => z.id));
      return { show: all.size > 0, highlight: all, label: "Mowing · all" };
    }
    if (mowingZones?.size) {
      const n = mowingZones.size;
      return {
        show: true,
        highlight: mowingZones,
        label: n === 1 ? "Mowing · 1 zone" : `Mowing · ${n} zones`,
      };
    }
    if (selected.size > 0) {
      const n = selected.size;
      return {
        show: true,
        highlight: selected,
        label: n === 1 ? "Mowing · 1 zone" : `Mowing · ${n} zones`,
      };
    }
    return { show: false, highlight: new Set(), label: "" };
  }

  function mergeConfig(config) {
    const c = { ...DEFAULTS, ...(config || {}) };
    // UI editor saves empty strings — do not wipe bundled default paths.
    if (!String(c.image_mower || "").trim()) c.image_mower = DEFAULTS.image_mower;
    if (!String(c.image_dock || "").trim()) c.image_dock = DEFAULTS.image_dock;
    c.hero_mode = normalizeHeroMode(c.hero_mode);
    c.units = normalizeUnits(c.units);
    c.show_map = cfgBool(c.show_map, DEFAULTS.show_map);
    c.map_size = normalizeMapSize(c.map_size);
    return c;
  }

  function normalizeUnits(value) {
    const raw = String(value ?? DEFAULTS.units).trim().toLowerCase();
    if (raw === "imperial" || raw === "us" || raw === "us_customary") return "imperial";
    if (raw === "auto") return "auto";
    return "metric";
  }

  function isImperial(hass, cfg) {
    const mode = normalizeUnits(cfg?.units);
    if (mode === "imperial") return true;
    if (mode === "metric") return false;
    const us = hass?.config?.unit_system;
    return us?.system === "us_customary" || us?.length === "mi";
  }

  function parseNumericText(raw) {
    if (raw == null || raw === "—" || raw === "") return null;
    const n = Number(String(raw).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }

  function formatCount(n, decimals = 0) {
    return n.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }

  function formatAreaStat(hass, cfg, raw) {
    const n = parseNumericText(raw);
    if (n == null) return null;
    if (!isImperial(hass, cfg)) return `${formatCount(n)} m²`;
    const sqft = n * 10.7639104167;
    if (sqft >= 43560) return `${formatCount(sqft / 43560, 2)} ac`;
    return `${formatCount(Math.round(sqft))} ft²`;
  }

  function formatBladeHeightStat(hass, cfg, raw) {
    if (raw === "—") return raw;
    const n = parseNumericText(raw);
    if (n == null) return String(raw);
    if (!isImperial(hass, cfg)) return `${formatCount(n)} mm`;
    return `${formatCount(n / 25.4, 2)} in`;
  }

  function normalizeHeroMode(value) {
    const raw = String(value ?? "auto").trim().toLowerCase();
    if (raw === "map" || raw === "art" || raw === "auto") return raw;
    return "auto";
  }

  function cfgBool(value, defaultValue = true) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return !/^(false|0|off|no)$/i.test(value.trim());
    return Boolean(value);
  }

  /** Resolve /local/ and relative paths for Lovelace + mobile apps. */
  function mediaUrl(hass, path) {
    if (!path) return "";
    const p = String(path);
    if (/^(https?:|data:|\/api\/)/i.test(p)) return p;
    if (typeof hass?.hassUrl === "function") return hass.hassUrl(p);
    const base = String(hass?.url || "").replace(/\/$/, "");
    return base ? `${base}${p.startsWith("/") ? p : `/${p}`}` : p;
  }

  function entityState(hass, entityId) {
    if (!entityId || !hass?.states?.[entityId]) return null;
    return hass.states[entityId];
  }

  function entityDomain(entityId) {
    return String(entityId || "").split(".")[0];
  }

  function isOn(hass, entityId) {
    const st = entityState(hass, entityId);
    return st?.state === "on";
  }

  function normalizeDeviceId(value) {
    if (!value) return null;
    if (typeof value === "string") {
      const s = value.trim();
      return s || null;
    }
    if (typeof value === "object") {
      return value.device_id || value.id || null;
    }
    return null;
  }

  function isBatteryThresholdEntity(uid, friendlyName) {
    const uidLower = String(uid || "").toLowerCase();
    const nameLower = String(friendlyName || "").toLowerCase();
    return (
      uidLower.endsWith("_auto_recharge_battery") ||
      uidLower.endsWith("_auto_resume_battery") ||
      nameLower.includes("auto recharge battery") ||
      nameLower.includes("auto resume battery")
    );
  }

  function scoreBatteryCandidate(hass, eid, ent) {
    const st = entityState(hass, eid);
    if (!st) return -1;
    const uid = ent.unique_id || "";
    const name = st.attributes?.friendly_name || "";
    if (isBatteryThresholdEntity(uid, name)) return -1;

    let score = 0;
    if (st.attributes?.device_class === "battery") score += 100;
    if (name.toLowerCase() === "battery") score += 80;
    if (String(uid).endsWith("_battery")) score += 60;
    if (st.attributes?.unit_of_measurement === "%") score += 20;
    const level = parseNumericState(hass, eid);
    if (level != null && level >= 0 && level <= 100) score += 50;
    return score;
  }

  function findBatteryOnDevice(hass, deviceId) {
    if (!deviceId) return null;
    let best = null;
    let bestScore = 0;
    for (const [eid, ent] of Object.entries(hass.entities || {})) {
      if (ent.device_id !== deviceId) continue;
      if (entityDomain(eid) !== "sensor") continue;
      const score = scoreBatteryCandidate(hass, eid, ent);
      if (score > bestScore) {
        bestScore = score;
        best = eid;
      }
    }
    return best;
  }

  function resolveBatteryEntity(hass, config, merged, deviceId) {
    const manual = normalizeEntityId(config.entity_battery);
    const candidates = [manual, merged.battery, findBatteryOnDevice(hass, deviceId)].filter(Boolean);
    const seen = new Set();
    for (const eid of candidates) {
      if (seen.has(eid)) continue;
      seen.add(eid);
      if (parseNumericState(hass, eid) != null) return eid;
    }
    return manual || merged.battery || findBatteryOnDevice(hass, deviceId);
  }

  function normalizeEntityId(value) {
    if (!value) return null;
    if (typeof value === "string") {
      const s = value.trim();
      return s || null;
    }
    if (typeof value === "object" && value.entity_id) {
      const s = String(value.entity_id).trim();
      return s || null;
    }
    return null;
  }

  /** Avoid auto_recharge_battery / auto_resume_battery matching the battery suffix. */
  function matchesEntitySuffix(uid, key, suffix) {
    if (!uid || !suffix || !uid.endsWith(suffix)) return false;
    if (key === "battery") {
      return !uid.endsWith("_auto_recharge_battery") && !uid.endsWith("_auto_resume_battery");
    }
    return true;
  }

  function parseNumericState(hass, entityId) {
    const st = entityState(hass, entityId);
    if (!st) return null;
    const raw = st.state;
    if (raw == null || raw === "unavailable" || raw === "unknown" || raw === "") return null;
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
    const m = String(raw).trim().match(/^(-?\d+(?:\.\d+)?)\s*%?$/);
    if (m) {
      const parsed = Number(m[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const attrs = st.attributes || {};
    for (const key of ["battery_level", "battery", "percentage", "level"]) {
      if (attrs[key] == null) continue;
      const n = Number(attrs[key]);
      if (Number.isFinite(n)) return n;
    }
    if (typeof hass?.formatEntityState === "function") {
      const formatted = String(hass.formatEntityState(st, entityId) || "");
      const fm = formatted.match(/(-?\d+(?:\.\d+)?)\s*%/);
      if (fm) {
        const parsed = Number(fm[1]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  function numState(hass, entityId) {
    return parseNumericState(hass, entityId);
  }

  function textState(hass, entityId, fallback = "—") {
    const st = entityState(hass, entityId);
    if (!st || st.state === "unavailable" || st.state === "unknown") return fallback;
    return String(st.state);
  }

  function entityExists(hass, entityId) {
    return Boolean(entityId && (hass?.states?.[entityId] || hass?.entities?.[entityId]));
  }

  function mowerSlug(mowerEntityId) {
    if (!mowerEntityId || !String(mowerEntityId).includes(".")) return null;
    return String(mowerEntityId).split(".").slice(1).join(".");
  }

  function entityFromMowerSuffix(mowerEntityId, suffix, domain) {
    const slug = mowerSlug(mowerEntityId);
    if (!slug || !suffix || !domain) return null;
    return `${domain}.${slug}${suffix}`;
  }

  function resolveDeviceId(hass, config, mowerEntityId) {
    const fromConfig = normalizeDeviceId(config?.device);
    if (fromConfig) return fromConfig;
    if (mowerEntityId && hass?.entities?.[mowerEntityId]?.device_id) {
      return hass.entities[mowerEntityId].device_id;
    }
    return null;
  }

  function entitySlugPart(entityId) {
    if (!entityId || !String(entityId).includes(".")) return "";
    return String(entityId).split(".").slice(1).join(".");
  }

  function suffixAliases(key, suffix) {
    return ENTITY_SUFFIX_ALIASES[key] || [suffix];
  }

  function matchesEntitySlug(entityId, key, suffix) {
    const slug = entitySlugPart(entityId);
    if (!slug) return false;
    return suffixAliases(key, suffix).some((s) => slug.endsWith(s));
  }

  function fillByNameHints(hass, devId, found) {
    if (!devId) return;
    for (const [eid, ent] of Object.entries(hass.entities || {})) {
      if (ent.device_id !== devId) continue;
      const domain = entityDomain(eid);
      const st = entityState(hass, eid);
      const name = String(st?.attributes?.friendly_name || ent.original_name || "").toLowerCase();
      for (const [key, patterns] of Object.entries(ENTITY_NAME_HINTS)) {
        if (found[key]) continue;
        const expectedDomain = ENTITY_DOMAINS[key];
        if (expectedDomain && domain !== expectedDomain) continue;
        if (!patterns.some((p) => p.test(name))) continue;
        if (canDiscoverEntity(hass, eid, key, domain)) found[key] = eid;
      }
    }
  }

  function applyMowerSlugFallbacks(hass, merged, mowerEntityId) {
    if (!mowerEntityId) return merged;
    for (const [key, suffix] of Object.entries(ENTITY_SUFFIXES)) {
      if (merged[key] || key === "mower") continue;
      const domain = ENTITY_DOMAINS[key];
      if (!domain) continue;
      for (const alias of suffixAliases(key, suffix)) {
        const guessed = entityFromMowerSuffix(mowerEntityId, alias, domain);
        if (entityExists(hass, guessed)) {
          merged[key] = guessed;
          break;
        }
      }
    }
    return merged;
  }

  function canDiscoverEntity(hass, eid, key, domain) {
    if (hass.states[eid]) return true;
    if (key === "map") return true;
    if (domain === "button" || domain === "switch") return entityExists(hass, eid);
    return false;
  }

  function resolveEntities(hass, config) {
    const manual = {
      mower: normalizeEntityId(config.entity_mower),
      status: normalizeEntityId(config.entity_status),
      battery: normalizeEntityId(config.entity_battery),
      progress: normalizeEntityId(config.entity_progress),
      area: normalizeEntityId(config.entity_area),
      map_area: normalizeEntityId(config.entity_map_area),
      blade: normalizeEntityId(config.entity_blade),
      rtk: normalizeEntityId(config.entity_rtk),
      map: normalizeEntityId(config.entity_map),
      map_geojson: normalizeEntityId(config.entity_map_geojson),
      mow_mode: normalizeEntityId(config.entity_mow_mode),
      online: normalizeEntityId(config.entity_online),
      mowing: normalizeEntityId(config.entity_mowing),
      charging: normalizeEntityId(config.entity_charging),
      error: normalizeEntityId(config.entity_error),
      lifted: normalizeEntityId(config.entity_lifted),
      rain: normalizeEntityId(config.entity_rain),
      headlights: normalizeEntityId(config.entity_headlights),
      btn_cancel: normalizeEntityId(config.entity_btn_cancel),
      btn_dock_cancel: normalizeEntityId(config.entity_btn_dock_cancel),
    };

    const devId = resolveDeviceId(hass, config, manual.mower);
    const found = Object.fromEntries(Object.keys(ENTITY_SUFFIXES).map((k) => [k, null]));
    const registry = hass.entities || {};

    if (devId) {
      for (const [eid, ent] of Object.entries(registry)) {
        if (ent.device_id !== devId) continue;
        const uid = ent.unique_id || "";
        const domain = entityDomain(eid);

        if (!found.mower && domain === "lawn_mower") {
          found.mower = eid;
        }

        for (const [key, suffix] of Object.entries(ENTITY_SUFFIXES)) {
          const uidMatch = matchesEntitySuffix(uid, key, suffix);
          const slugMatch = matchesEntitySlug(eid, key, suffix);
          if (!uidMatch && !slugMatch) continue;
          if (key === "error" && domain !== "binary_sensor") continue;
          if (key === "mower") continue;
          if (canDiscoverEntity(hass, eid, key, domain)) {
            found[key] = eid;
          }
        }
      }
      fillByNameHints(hass, devId, found);
    }

    const merged = { ...found };
    for (const [key, value] of Object.entries(manual)) {
      if (value) merged[key] = value;
    }
    merged.mower = manual.mower || found.mower;
    applyMowerSlugFallbacks(hass, merged, merged.mower);
    merged.battery = resolveBatteryEntity(hass, config, merged, devId);
    return merged;
  }

  function mowerActivity(hass, entities) {
    const st = entityState(hass, entities.mower);
    if (st?.state) return String(st.state).toLowerCase();
    const status = textState(hass, entities.status, "");
    if (/mow/i.test(status)) return "mowing";
    if (/dock|charg|wait|idle|full/i.test(status)) return "docked";
    if (/pause/i.test(status)) return "paused";
    if (/return|dock/i.test(status)) return "returning";
    if (/error|emergency/i.test(status)) return "error";
    return "unknown";
  }

  function mowerFeatures(hass, entities) {
    const st = entityState(hass, entities.mower);
    const raw = st?.attributes?.supported_features;
    if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
    return null;
  }

  const FEATURE = { START: 1, PAUSE: 2, DOCK: 4 };

  function canStart(features) {
    return features == null || (features & FEATURE.START) !== 0;
  }
  function canPause(features) {
    return features == null || (features & FEATURE.PAUSE) !== 0;
  }
  function canDock(features) {
    return features == null || (features & FEATURE.DOCK) !== 0;
  }

  function displayStatus(hass, entities, activity, pending, cfg) {
    if (pending) return pending === "start" ? "Starting…" : pending === "pause" ? "Pausing…" : "Docking…";
    if (cfg?.state_text) return cfg.state_text;

    const charging = isOn(hass, entities.charging);
    const mowerState = String(entityState(hass, entities.mower)?.state || "").toLowerCase();
    const detail = textState(hass, entities.status, "");

    if (charging || mowerState === "charging") return "Charging";
    if (mowerState === "docked") return "Docked";
    if (mowerState === "mowing") return "Mowing";
    if (mowerState === "paused") return "Paused";
    if (mowerState === "returning") return "Returning";
    if (mowerState === "error") return "Error";

    if (/^charg/i.test(detail)) return detail;
    if (/^wait/i.test(detail)) {
      if (charging) return "Charging";
      if (activity === "docked") return "Docked";
      return "Waiting";
    }
    if (detail && detail !== "—") return detail;
    return ACTIVITY_LABELS[activity] || "Unknown";
  }

  function statusPhase(activity, hass, entities) {
    if (isOn(hass, entities.error)) return "error";
    if (activity === "mowing") return "mowing";
    if (activity === "returning") return "returning";
    if (activity === "paused") return "paused";
    if (isOn(hass, entities.charging)) return "charging";
    if (activity === "docked") return "docked";
    return activity || "idle";
  }

  function hasLymowService(hass, service) {
    return Boolean(hass?.services?.lymow?.[service]);
  }

  function lymowDeviceTarget(hass, config, entities) {
    const devId = resolveDeviceId(hass, config, entities?.mower);
    return devId ? { device_id: devId } : {};
  }

  function isActiveRun(activity) {
    return activity === "mowing" || activity === "returning" || activity === "paused";
  }

  function showMapHero(cfg, activity) {
    const mode = normalizeHeroMode(cfg.hero_mode);
    if (mode === "art") return false;
    if (mode === "map") return true;
    if (!cfgBool(cfg.show_map, true)) return false;
    return isActiveRun(activity);
  }

  function showArtHero(cfg, activity) {
    const mode = normalizeHeroMode(cfg.hero_mode);
    if (mode === "art") return true;
    if (mode === "map") return false;
    return !isActiveRun(activity);
  }

  /** Art in auto (docked) and art mode; map mode only if no map camera entity. */
  function shouldShowArt(cfg, activity, hasMap) {
    const mode = normalizeHeroMode(cfg.hero_mode);
    if (mode === "art") return true;
    if (mode === "map") return !hasMap;
    return !isActiveRun(activity);
  }

  function heroArtPath(cfg, activity) {
    return isActiveRun(activity) ? cfg.image_mower : cfg.image_dock || cfg.image_mower;
  }

  function batteryEntityFromMower(mowerEntityId) {
    if (!mowerEntityId || !String(mowerEntityId).includes(".")) return null;
    const slug = String(mowerEntityId).split(".").slice(1).join(".");
    return slug ? `sensor.${slug}_battery` : null;
  }

  function batteryLevel(hass, entities) {
    const entityId =
      typeof entities === "string"
        ? entities
        : entities?.battery || batteryEntityFromMower(entities?.mower);
    const fromSensor = parseNumericState(hass, entityId);
    if (fromSensor != null) return fromSensor;
    const mower = entityState(hass, typeof entities === "object" ? entities?.mower : null);
    if (mower?.attributes?.battery_level != null) {
      const n = Number(mower.attributes.battery_level);
      if (Number.isFinite(n)) return n;
    }
    const guessed = batteryEntityFromMower(typeof entities === "object" ? entities?.mower : null);
    if (guessed && guessed !== entityId) {
      const fromGuess = parseNumericState(hass, guessed);
      if (fromGuess != null) return fromGuess;
    }
    return null;
  }

  function batteryClass(level, charging) {
    if (level == null) return "";
    if (charging) return "charging";
    if (level <= 15) return "critical";
    if (level <= 35) return "low";
    return "";
  }

  function cameraProxyUrl(hass, entityId, token) {
    if (!entityId) return "";
    return `/api/camera_proxy/${entityId}?token=${encodeURIComponent(token || "")}&t=${Date.now()}`;
  }

  function isConfigIncomplete(config) {
    return !config?.device && !config?.entity_mower;
  }

  function hasStartZonesService(hass) {
    return Boolean(hass?.services?.lymow?.start_zones);
  }

  function isHashLike(value) {
    const s = String(value || "").trim();
    return /^[A-Za-z0-9_-]{6,}$/.test(s) && !/\s/.test(s);
  }

  function zoneDisplayName(props, id, index) {
    const candidates = [
      props.displayName,
      props.label,
      props.zoneName,
      props.zone_name,
      props.title,
      props.name,
    ]
      .filter((v) => v != null && String(v).trim())
      .map((v) => String(v).trim());

    for (const raw of candidates) {
      if (raw === id || isHashLike(raw)) continue;
      const zoneNum = raw.match(/^zone\s*(\d+)$/i);
      if (zoneNum) return `Zone ${zoneNum[1]}`;
      return raw;
    }
    return `Zone ${index + 1}`;
  }

  const WGS84_A = 6378137;

  function ringSpan(ring) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  function ringLooksLikeEnu(ring) {
    const { width } = ringSpan(ring);
    return width > 2;
  }

  function ringLooksLikeWgs84(ring) {
    const { width, height, minX, maxX, minY, maxY } = ringSpan(ring);
    if (maxX > 180 || minX < -180 || maxY > 90 || minY < -90) return false;
    return width < 1 && height < 1;
  }

  function enuBasePoint(attrs) {
    const ebp = attrs?.enu_base_point || {};
    const lat0 = Number(ebp.latitude ?? ebp.lat);
    const lon0 = Number(ebp.longitude ?? ebp.lon ?? ebp.lng);
    if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return null;
    return { lat0, lon0 };
  }

  function renderDebugReady(renderDebug) {
    return (
      renderDebug &&
      ["min_x", "max_x", "min_y", "max_y"].every((k) => Number.isFinite(renderDebug[k]))
    );
  }

  function computeWgs84Bounds(rings) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let count = 0;
    for (const ring of rings) {
      if (!ringLooksLikeWgs84(ring)) continue;
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        count += 1;
      }
    }
    if (!count || !Number.isFinite(minLon)) return null;
    return { minLon, maxLon, minLat, maxLat };
  }

  /** Map WGS84 rings directly onto map camera ENU bounds (property-scale accurate). */
  function mapWgs84RingToRenderEnu(ring, wgsBounds, renderDebug) {
    const lonSpan = wgsBounds.maxLon - wgsBounds.minLon || 1e-9;
    const latSpan = wgsBounds.maxLat - wgsBounds.minLat || 1e-9;
    const xSpan = renderDebug.max_x - renderDebug.min_x;
    const ySpan = renderDebug.max_y - renderDebug.min_y;
    return ring.map(([lon, lat]) => [
      renderDebug.min_x + ((lon - wgsBounds.minLon) / lonSpan) * xSpan,
      renderDebug.min_y + ((lat - wgsBounds.minLat) / latSpan) * ySpan,
    ]);
  }

  function mergeGeoAttrs(geoAttrs, mapAttrs) {
    const geo = geoAttrs || {};
    const map = mapAttrs || {};
    return {
      ...geo,
      has_gps_origin: gpsOriginReady(geo) || map.has_enu_base_point === true,
      enu_base_point: geo.enu_base_point || map.enu_base_point || null,
    };
  }

  function convertRingForMap(rawRing, feature, attrs, renderDebug, wgsBounds) {
    if (renderDebugReady(renderDebug) && wgsBounds && ringLooksLikeWgs84(rawRing)) {
      return mapWgs84RingToRenderEnu(rawRing, wgsBounds, renderDebug);
    }
    return resolveZoneRing(rawRing, feature, attrs, renderDebug);
  }

  function ringProjectsToView(projection, ring) {
    if (!projection || !ring?.length) return false;
    for (const [x, y] of ring) {
      const [nx, ny] = projection.toPoint(x, y);
      if (Number.isFinite(nx) && Number.isFinite(ny) && nx >= -5 && nx <= 105 && ny >= -5 && ny <= 105) {
        return true;
      }
    }
    return false;
  }

  function zonesProjectToView(zones, projection) {
    if (!zones?.length || !projection) return false;
    return zones.some((z) => ringProjectsToView(projection, z.ring));
  }

  /** Schematic fit for WGS84 [lon, lat] rings — always fills the 0–100 viewBox. */
  function wgs84SchematicProjection(rings) {
    const bounds = computeWgs84Bounds(rings);
    if (!bounds) return null;
    return boundsSchematicProjection({
      minX: bounds.minLon,
      maxX: bounds.maxLon,
      minY: bounds.minLat,
      maxY: bounds.maxLat,
    });
  }

  function ringBoundsFromRings(rings) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const ring of rings) {
      if (!ring?.length) continue;
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
    if (!count || !Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY };
  }

  function boundsSchematicProjection(bounds) {
    if (!bounds) return null;
    const W = 100;
    const PAD = 8;
    const xSpan = bounds.maxX - bounds.minX || 1e-9;
    const ySpan = bounds.maxY - bounds.minY || 1e-9;
    const scale = (W - PAD * 2) / Math.max(xSpan, ySpan);
    return {
      toPoint(x, y) {
        return [(x - bounds.minX) * scale + PAD, W - ((y - bounds.minY) * scale + PAD)];
      },
      toPoints(ring) {
        return ring
          .map(([x, y]) => {
            const [nx, ny] = this.toPoint(x, y);
            return `${nx.toFixed(2)},${ny.toFixed(2)}`;
          })
          .join(" ");
      },
    };
  }

  function ringMatchesMapBounds(ring, renderDebug) {
    if (!renderDebug || !ring?.length) return false;
    const keys = ["min_x", "max_x", "min_y", "max_y"];
    if (!keys.every((k) => Number.isFinite(renderDebug[k]))) return false;
    const { minX, maxX, minY, maxY } = ringSpan(ring);
    const padX = Math.max((renderDebug.max_x - renderDebug.min_x) * 0.35, 1);
    const padY = Math.max((renderDebug.max_y - renderDebug.min_y) * 0.35, 1);
    return (
      minX >= renderDebug.min_x - padX &&
      maxX <= renderDebug.max_x + padX &&
      minY >= renderDebug.min_y - padY &&
      maxY <= renderDebug.max_y + padY
    );
  }

  function ringToEnu(rawRing, feature, attrs) {
    const origin = enuBasePoint(attrs);
    const mode = ringCoordMode(feature);

    if (mode === "enu") return rawRing;

    // Lymow-HA emits WGS84 [lon, lat] when has_gps_origin is true (or coords look geographic).
    if (origin && (gpsOriginReady(attrs) || ringLooksLikeWgs84(rawRing))) {
      return latLonRingToEnu(rawRing, origin.lat0, origin.lon0);
    }

    if (ringLooksLikeEnu(rawRing)) return rawRing;

    if (origin && ringLooksLikeWgs84(rawRing)) {
      let enu = latLonRingToEnu(rawRing, origin.lat0, origin.lon0);
      if (ringSpan(enu).width < 0.01) {
        enu = latLonRingToEnu(
          rawRing.map(([a, b]) => [b, a]),
          origin.lat0,
          origin.lon0
        );
      }
      return enu;
    }

    return rawRing;
  }

  function resolveZoneRing(rawRing, feature, attrs, renderDebug) {
    let ring = ringToEnu(rawRing, feature, attrs);
    if (!renderDebug || ringMatchesMapBounds(ring, renderDebug)) return ring;

    const origin = enuBasePoint(attrs);
    if (!origin) return ring;

    const candidates = [
      latLonRingToEnu(rawRing, origin.lat0, origin.lon0),
      latLonRingToEnu(rawRing.map(([a, b]) => [b, a]), origin.lat0, origin.lon0),
      rawRing,
    ];
    for (const candidate of candidates) {
      if (ringMatchesMapBounds(candidate, renderDebug)) return candidate;
    }
    return ring;
  }

  /** Match Lymow-HA build_map_png: uniform scale, PAD, Y-flip. */
  function lymowMapProjection(renderDebug, ringBounds) {
    const W = 100;
    const H = 100;
    const PAD = 5;
    const dbgOk = ["min_x", "max_x", "min_y", "max_y"].every((k) =>
      Number.isFinite(renderDebug?.[k])
    );
    const min_x = dbgOk ? renderDebug.min_x : ringBounds?.minX;
    const max_x = dbgOk ? renderDebug.max_x : ringBounds?.maxX;
    const min_y = dbgOk ? renderDebug.min_y : ringBounds?.minY;
    const max_y = dbgOk ? renderDebug.max_y : ringBounds?.maxY;
    if (![min_x, max_x, min_y, max_y].every(Number.isFinite)) return null;
    const scale = (W - PAD * 2) / Math.max(max_x - min_x || 1, max_y - min_y || 1);
    return {
      usesMapBounds: dbgOk,
      toPoint(x, y) {
        return [(x - min_x) * scale + PAD, H - ((y - min_y) * scale + PAD)];
      },
      toPoints(ring) {
        return ring
          .map(([x, y]) => {
            const [nx, ny] = this.toPoint(x, y);
            return `${nx.toFixed(2)},${ny.toFixed(2)}`;
          })
          .join(" ");
      },
    };
  }

  function gpsOriginReady(attrs) {
    const v = attrs?.has_gps_origin;
    return v === true || v === "true" || v === 1;
  }

  function featureCollectionFeatures(value) {
    if (!value) return null;
    let parsed = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    if (Array.isArray(parsed?.features)) return parsed.features;
    return null;
  }

  /** Outer rings from GeoJSON Polygon or MultiPolygon. */
  function extractFeatureRings(geom) {
    if (!geom) return [];
    if (geom.type === "Polygon" && geom.coordinates?.[0]?.length) {
      return [geom.coordinates[0]];
    }
    if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      return geom.coordinates.map((poly) => poly?.[0]).filter((ring) => ring?.length >= 3);
    }
    return [];
  }

  function ringToFlatPairs(ring) {
    return ring
      .map((pt) => [Number(pt[0]), Number(pt[1])])
      .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  }

  function shapePanelProjection(zoneFeatures, renderDebug) {
    const ringBounds = zoneFeatureBounds(zoneFeatures);
    if (renderDebugReady(renderDebug) && ringBounds) {
      return { proj: lymowMapProjection(renderDebug, ringBounds), ringKey: "ring" };
    }
    if (ringBounds && ringBounds.width > 0.01) {
      return { proj: boundsSchematicProjection(ringBounds), ringKey: "ring" };
    }
    const rawRings = zoneFeatures.map((z) => z.rawRing).filter(Boolean);
    const wgs = wgs84SchematicProjection(rawRings);
    if (wgs) return { proj: wgs, ringKey: "rawRing" };
    const generic = boundsSchematicProjection(ringBoundsFromRings(zoneFeatures.map((z) => z.rawRing || z.ring)));
    return { proj: generic, ringKey: "rawRing" };
  }

  function paintZoneShapeCanvas(canvas, zoneFeatures, selected, renderDebug) {
    if (!canvas || !zoneFeatures?.length) return false;
    const picked = shapePanelProjection(zoneFeatures, renderDebug);
    if (!picked?.proj) return false;

    const cssSize = Math.max(canvas.clientWidth || 0, canvas.clientHeight || 0, 120);
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(cssSize * dpr);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const scale = cssSize / 100;
    const drawRing = (ring, style) => {
      if (!ring?.length) return;
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [nx, ny] = picked.proj.toPoint(ring[i][0], ring[i][1]);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
        const x = nx * scale;
        const y = ny * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill();
      }
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    };

    let drew = 0;
    for (const z of zoneFeatures) {
      let ring = picked.ringKey === "rawRing" ? z.rawRing || z.ring : z.ring;
      if (!ring?.length) continue;
      const on = zoneIsSelected(z, selected);
      if (!on) {
        drawRing(ring, {
          stroke: "rgba(148, 163, 184, 0.7)",
          lineWidth: 1.2,
        });
        drew += 1;
      }
    }
    for (const z of zoneFeatures) {
      let ring = picked.ringKey === "rawRing" ? z.rawRing || z.ring : z.ring;
      if (!ring?.length) continue;
      if (!zoneIsSelected(z, selected)) continue;
      drawRing(ring, {
        fill: "rgba(34, 197, 94, 0.22)",
        stroke: "#22c55e",
        lineWidth: 2.8,
      });
      drew += 1;
      const [cx, cy] = picked.proj.toPoint(...ringCentroid(ring));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        ctx.fillStyle = "#ecfdf5";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(z.shortLabel || z.name), cx * scale, cy * scale);
      }
    }
    return drew > 0;
  }

  function ringsBoundsAlignToMap(zones, renderDebug) {
    const rb = zoneFeatureBounds(zones);
    if (!rb || !renderDebug) return false;
    const keys = ["min_x", "max_x", "min_y", "max_y"];
    if (!keys.every((k) => Number.isFinite(renderDebug[k]))) return false;
    const padX = Math.max((renderDebug.max_x - renderDebug.min_x) * 0.08, 1);
    const padY = Math.max((renderDebug.max_y - renderDebug.min_y) * 0.08, 1);
    return (
      rb.minX >= renderDebug.min_x - padX &&
      rb.maxX <= renderDebug.max_x + padX &&
      rb.minY >= renderDebug.min_y - padY &&
      rb.maxY <= renderDebug.max_y + padY
    );
  }

  /** Shift converted ENU rings onto the map camera bounds (handles rounded origin). */
  function alignZonesToMapBounds(zones, renderDebug) {
    if (!zones?.length || !renderDebug) return zones;
    const rb = zoneFeatureBounds(zones);
    if (!rb || rb.width < 2 || rb.height < 2) return zones;
    if (ringsBoundsAlignToMap(zones, renderDebug)) return zones;

    const dx = renderDebug.min_x - rb.minX;
    const dy = renderDebug.min_y - rb.minY;
    const dw = renderDebug.max_x - renderDebug.min_x;
    const dh = renderDebug.max_y - renderDebug.min_y;
    if (Math.abs(dx) > dw || Math.abs(dy) > dh) return zones;

    return zones.map((z) => ({
      ...z,
      ring: z.ring.map(([x, y]) => [x + dx, y + dy]),
    }));
  }

  /** Use map camera bounds only when zone rings already sit in that ENU frame. */
  function pickOverlayProjection(renderDebug, ringBounds) {
    const dbgOk =
      renderDebug &&
      ["min_x", "max_x", "min_y", "max_y"].every((k) => Number.isFinite(renderDebug[k]));
    if (dbgOk) return lymowMapProjection(renderDebug, ringBounds);
    return lymowMapProjection(null, ringBounds);
  }

  function zoneIsSelected(zone, selected) {
    if (!selected?.size) return false;
    if (selected.has(zone.id)) return true;
    for (const sid of selected) {
      if (String(sid) === String(zone.id)) return true;
    }
    return false;
  }

  function latLonRingToEnu(ring, lat0, lon0) {
    const latRad = (lat0 * Math.PI) / 180;
    return ring.map(([lon, lat]) => {
      const north_m = ((lat - lat0) * Math.PI) / 180 * WGS84_A;
      const east_m = ((lon - lon0) * Math.PI) / 180 * WGS84_A * Math.cos(latRad);
      // Lymow map coordinates: x = east, y = north (matches Lymow-HA _enu_to_latlon).
      return [east_m, north_m];
    });
  }

  function ringCentroid(ring) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }

  function ringCoordMode(feature) {
    const crs = feature?.geometry?._crs || feature?.properties?._crs;
    if (crs === "ENU_metres") return "enu";
    return "wgs84";
  }

  /** Zone polygons aligned to Lymow map camera (ENU + render_debug). */
  function loadZoneFeatures(hass, entityId, mapEntityId) {
    const st = entityId ? entityState(hass, entityId) : null;
    if (!st?.attributes) return { zones: [], overlayProjection: null };

    const mapSt = mapEntityId ? entityState(hass, mapEntityId) : null;
    const renderDebug = mapSt?.attributes?.render_debug || null;
    const attrs = mergeGeoAttrs(st.attributes, mapSt?.attributes);

    let features =
      featureCollectionFeatures(attrs.geojson_zones) ||
      featureCollectionFeatures(attrs.geojson) ||
      [];
    if (!features.length && Array.isArray(attrs.geojson_zones?.features)) {
      features = attrs.geojson_zones.features;
    }
    if (!features.length && Array.isArray(attrs.geojson?.features)) {
      features = attrs.geojson.features;
    }

    const pending = [];
    for (const f of features) {
      const p = f?.properties || {};
      if (p.type && p.type !== "zone") continue;
      const id = p.hashId || p.hash_id || p.id;
      if (!id) continue;
      const geom = f.geometry;
      const outerRings = extractFeatureRings(geom);
      if (!outerRings.length) continue;

      const rawRing = ringToFlatPairs(outerRings[0]);
      if (rawRing.length < 3) continue;
      pending.push({ f, p, id: String(id), rawRing });
    }

    const wgsBounds = computeWgs84Bounds(pending.map((item) => item.rawRing));

    const zones = [];
    const seen = new Set();
    for (const item of pending) {
      if (seen.has(item.id)) continue;
      let ring = convertRingForMap(item.rawRing, item.f, attrs, renderDebug, wgsBounds);
      seen.add(item.id);
      const index = zones.length;
      const name = zoneDisplayName(item.p, item.id, index);
      const zoneNum = name.match(/^Zone\s+(\d+)$/i);
      zones.push({
        id: item.id,
        name,
        shortLabel: zoneNum ? zoneNum[1] : name.slice(0, 8),
        index,
        ring,
        rawRing: item.rawRing,
      });
    }

    zones.sort((a, b) => {
      const na = a.name.match(/^Zone\s+(\d+)$/i);
      const nb = b.name.match(/^Zone\s+(\d+)$/i);
      if (na && nb) return Number(na[1]) - Number(nb[1]);
      return a.index - b.index;
    });

    let alignedZones = alignZonesToMapBounds(zones, renderDebug);
    let ringBounds = zoneFeatureBounds(alignedZones);
    let overlayProjection = pickOverlayProjection(renderDebug, ringBounds);

    if (
      overlayProjection &&
      !zonesProjectToView(alignedZones, overlayProjection) &&
      wgsBounds &&
      renderDebugReady(renderDebug)
    ) {
      alignedZones = pending.map((item, index) => {
        const name = zoneDisplayName(item.p, item.id, index);
        const zoneNum = name.match(/^Zone\s+(\d+)$/i);
        return {
          id: item.id,
          name,
          shortLabel: zoneNum ? zoneNum[1] : name.slice(0, 8),
          index,
          ring: mapWgs84RingToRenderEnu(item.rawRing, wgsBounds, renderDebug),
          rawRing: item.rawRing,
        };
      });
      alignedZones.sort((a, b) => {
        const na = a.name.match(/^Zone\s+(\d+)$/i);
        const nb = b.name.match(/^Zone\s+(\d+)$/i);
        if (na && nb) return Number(na[1]) - Number(nb[1]);
        return a.index - b.index;
      });
      ringBounds = zoneFeatureBounds(alignedZones);
      overlayProjection = pickOverlayProjection(renderDebug, ringBounds);
    }

    return { zones: alignedZones, overlayProjection };
  }

  function zoneFeatureBounds(zoneFeatures) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const z of zoneFeatures) {
      for (const [x, y] of z.ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) return null;
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    return { minX, minY, maxX, maxY, width, height, pad: 4 };
  }

  /** Zone list from Map GeoJSON sensor (Lymow-HA). */
  function loadZones(hass, entityId, mapEntityId) {
    return loadZoneFeatures(hass, entityId, mapEntityId).zones.map(({ id, name, index }) => ({
      id,
      name,
      index,
    }));
  }

  function zoneSelectionSummary(selected, total, mowAll) {
    if (mowAll) return "All zones";
    if (!selected?.size) return "No zones selected";
    if (selected.size === 1) return "1 zone selected";
    if (selected.size === total) return `${total} zones selected`;
    return `${selected.size} zones selected`;
  }

  class LymowCard extends LitElement {
    static get properties() {
      return {
        hass: {},
        config: {},
        _busy: { state: false },
        _pending: { state: null },
        _mapTick: { state: 0 },
        _mapFailed: { state: false },
        _artFailedSrc: { state: null },
        _selectedZones: { state: true },
        _mowAllZones: { state: true },
        _mowingZoneIds: { state: true },
        _mowingAllZones: { state: true },
        _mapZoomOpen: { state: false },
      };
    }

    static getConfigElement() {
      return document.createElement("lymow-card-editor");
    }

    static getStubConfig() {
      return { type: "custom:lymow-card" };
    }

    getCardSize() {
      const cfg = mergeConfig(this.config);
      let size = 4;
      if (cfg.show_stats) size += 1;
      if (cfg.show_mow_mode) size += 1;
      if (cfg.show_secondary_actions) size += 1;
      if (cfg.show_zone_picker !== false && this.hass) {
        const entities = resolveEntities(this.hass, cfg);
        const zones = loadZones(
          this.hass,
          cfg.entity_map_geojson || entities.map_geojson,
          entities.map
        );
        if (zones.length > 0) size += 2;
      }
      return size;
    }

    setConfig(config) {
      this.config = mergeConfig(config);
      this._selectedZones = this._selectedZones || new Set();
      this._mowAllZones = this._mowAllZones || false;
      this._mowingZoneIds = this._mowingZoneIds || new Set();
      this._mowingAllZones = this._mowingAllZones || false;
    }

    _zoneList(cfg, entities) {
      return loadZones(
        this.hass,
        cfg.entity_map_geojson || entities.map_geojson,
        entities.map
      );
    }

    _zoneFeatureData(cfg, entities) {
      return loadZoneFeatures(
        this.hass,
        cfg.entity_map_geojson || entities.map_geojson,
        entities.map
      );
    }

    _selectedZoneSet() {
      if (!this._selectedZones) this._selectedZones = new Set();
      return this._selectedZones;
    }

    _mowingZoneSet() {
      if (!this._mowingZoneIds) this._mowingZoneIds = new Set();
      return this._mowingZoneIds;
    }

    _syncMowingZoneState(activity) {
      if (isActiveRun(activity)) return;
      if (this._mowingZoneSet().size || this._mowingAllZones) {
        this._mowingZoneIds = new Set();
        this._mowingAllZones = false;
      }
    }

    _shapePanelState(cfg, entities, activity, zoneFeatures) {
      return resolveShapePanelState(
        cfg,
        activity,
        this._selectedZoneSet(),
        this._mowAllZones,
        this._mowingZoneSet(),
        this._mowingAllZones,
        zoneFeatures
      );
    }

    _toggleZone(zoneId) {
      this._mowAllZones = false;
      const next = new Set(this._selectedZoneSet());
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      this._selectedZones = next;
      this._mapFailed = false;
      this.requestUpdate();
    }

    _selectAllZones() {
      this._mowAllZones = true;
      this._selectedZones = new Set();
      this._mapFailed = false;
      this.requestUpdate();
    }

    _hasStartSelection(cfg) {
      if (cfg.show_zone_picker === false) return true;
      return this._mowAllZones || this._selectedZoneSet().size > 0;
    }

    connectedCallback() {
      super.connectedCallback();
      this._startMapTimer();
      this._scheduleZoneShapePaint();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._stopMapTimer();
      if (this._shapePaintRaf) {
        cancelAnimationFrame(this._shapePaintRaf);
        this._shapePaintRaf = null;
      }
    }

    updated(changed) {
      super.updated(changed);
      if (changed.has("config")) {
        this._stopMapTimer();
        this._startMapTimer();
        this._mapFailed = false;
        this._artFailedSrc = null;
      }
      if (changed.has("hass") && this._mapFailed) {
        const entities = resolveEntities(this.hass, mergeConfig(this.config));
        const activity = mowerActivity(this.hass, entities);
        if (!showMapHero(mergeConfig(this.config), activity)) {
          this._mapFailed = false;
        }
      }
      if (this._pending && changed.has("hass")) {
        this._clearPendingIfDone();
      }
      if (
        changed.has("hass") ||
        changed.has("_selectedZones") ||
        changed.has("_mowingZoneIds") ||
        changed.has("_mowingAllZones") ||
        changed.has("_mapTick") ||
        changed.has("config")
      ) {
        this._scheduleZoneShapePaint();
      }
      if (changed.has("hass")) {
        const entities = resolveEntities(this.hass, mergeConfig(this.config));
        this._syncMowingZoneState(mowerActivity(this.hass, entities));
      }
    }

    _scheduleZoneShapePaint() {
      if (this._shapePaintRaf) cancelAnimationFrame(this._shapePaintRaf);
      this._shapePaintRaf = requestAnimationFrame(() => {
        this._shapePaintRaf = null;
        this._paintZoneShapePanel();
      });
    }

    _paintZoneShapePanel() {
      const canvas = this.shadowRoot?.querySelector("canvas.zone-shape-canvas");
      if (!canvas || !this.hass) return;
      const cfg = mergeConfig(this.config);
      const entities = resolveEntities(this.hass, cfg);
      const activity = mowerActivity(this.hass, entities);
      const { zones } = this._zoneFeatureData(cfg, entities);
      const panel = this._shapePanelState(cfg, entities, activity, zones);
      if (!panel.show || !panel.highlight.size) return;
      const mapSt = entityState(this.hass, entities.map);
      const renderDebug = mapSt?.attributes?.render_debug || null;
      paintZoneShapeCanvas(canvas, zones, panel.highlight, renderDebug);
    }

    _startMapTimer() {
      this._stopMapTimer();
      const secs = Number(mergeConfig(this.config).map_refresh_seconds) || 30;
      this._mapTimer = window.setInterval(() => {
        this._mapTick = Date.now();
      }, Math.max(10, secs) * 1000);
    }

    _stopMapTimer() {
      if (this._mapTimer) {
        clearInterval(this._mapTimer);
        this._mapTimer = null;
      }
    }

    _clearPendingIfDone() {
      const entities = resolveEntities(this.hass, this.config);
      const activity = mowerActivity(this.hass, entities);
      if (this._pending === "start" && (activity === "mowing" || activity === "returning")) {
        this._pending = null;
      } else if (this._pending === "pause" && activity === "paused") {
        this._pending = null;
      } else if (this._pending === "dock" && (activity === "returning" || activity === "docked")) {
        this._pending = null;
      }
    }

    async _call(domain, service, data) {
      await this.hass.callService(domain, service, data);
    }

    async _mowerAction(action) {
      const entities = resolveEntities(this.hass, this.config);
      if (!entities.mower || this._busy) return;
      this._busy = true;
      this._pending = action === "start_mowing" ? "start" : action === "pause" ? "pause" : "dock";
      try {
        await this._call("lawn_mower", action, { entity_id: entities.mower });
      } finally {
        this._busy = false;
      }
    }

    async _startMowing(cfg, entities) {
      if (!entities.mower || this._busy) return;
      const zones = this._zoneList(cfg, entities);
      const selected = this._selectedZoneSet();
      const useZones =
        cfg.show_zone_picker !== false &&
        !this._mowAllZones &&
        hasStartZonesService(this.hass) &&
        selected.size > 0 &&
        zones.length > 0;

      this._busy = true;
      this._pending = "start";
      try {
        if (useZones) {
          const payload = {
            zones: [...selected],
          };
          if (cfg.device) payload.device_id = cfg.device;
          await this._call("lymow", "start_zones", payload);
          this._mowingZoneIds = new Set(selected);
          this._mowingAllZones = false;
        } else {
          await this._call("lawn_mower", "start_mowing", { entity_id: entities.mower });
          this._mowingZoneIds = new Set();
          this._mowingAllZones = true;
        }
      } finally {
        this._busy = false;
      }
    }

    async _primaryAction(cfg, entities, primaryAction, resume = false) {
      if (primaryAction === "start_mowing" && !resume) {
        await this._startMowing(cfg, entities);
        return;
      }
      await this._mowerAction(primaryAction);
    }

    async _pressButton(entityId) {
      if (!entityId || this._busy) return;
      this._busy = true;
      try {
        await this._call("button", "press", { entity_id: entityId });
      } finally {
        this._busy = false;
      }
    }

    _canCancelTask(cfg, entities) {
      return Boolean(entities.btn_cancel || hasLymowService(this.hass, "cancel_task"));
    }

    _canDockCancel(cfg, entities) {
      return Boolean(entities.btn_dock_cancel || hasLymowService(this.hass, "dock_cancel_task"));
    }

    async _cancelTask(cfg, entities) {
      if (this._busy) return;
      this._busy = true;
      try {
        if (entities.btn_cancel) {
          await this._call("button", "press", { entity_id: entities.btn_cancel });
        } else if (hasLymowService(this.hass, "cancel_task")) {
          await this._call("lymow", "cancel_task", lymowDeviceTarget(this.hass, cfg, entities));
        }
      } finally {
        this._busy = false;
      }
    }

    async _dockCancelTask(cfg, entities) {
      if (this._busy) return;
      this._busy = true;
      this._pending = "dock";
      try {
        if (entities.btn_dock_cancel) {
          await this._call("button", "press", { entity_id: entities.btn_dock_cancel });
        } else if (hasLymowService(this.hass, "dock_cancel_task")) {
          await this._call("lymow", "dock_cancel_task", lymowDeviceTarget(this.hass, cfg, entities));
        }
      } finally {
        this._busy = false;
      }
    }

    async _dockAction(cfg, entities, activity) {
      if (this._busy) return;
      if (activity === "mowing" || activity === "paused" || activity === "returning") {
        await this._mowerAction("dock");
        return;
      }
      await this._dockCancelTask(cfg, entities);
    }

    async _toggleHeadlights(entities) {
      const eid = entities.headlights;
      if (!eid || this._busy) return;
      const st = entityState(this.hass, eid);
      if (!st || st.state === "unavailable" || st.state === "unknown") return;
      this._busy = true;
      try {
        const service = st.state === "on" ? "turn_off" : "turn_on";
        await this._call("switch", service, { entity_id: eid });
      } finally {
        this._busy = false;
      }
    }

    async _setMowMode(entityId, option) {
      if (!entityId || !option || this._busy) return;
      this._busy = true;
      try {
        await this._call("select", "select_option", { entity_id: entityId, option });
      } finally {
        this._busy = false;
      }
    }

    _renderBattery(level, charging) {
      const pct = level == null ? "—" : `${Math.round(level)}%`;
      const cls = batteryClass(level, charging);
      const arc = level == null ? 0 : Math.min(100, Math.max(0, level));
      const dash = (arc / 100) * 88;
      return html`
        <div class="battery ${cls}" title="Battery ${pct}">
          <svg viewBox="0 0 36 20" aria-hidden="true">
            <rect x="1" y="4" width="30" height="12" rx="3" class="bat-body" />
            <rect x="32" y="7" width="3" height="6" rx="1" class="bat-cap" />
            <rect x="3" y="6" width="${(28 * arc) / 100}" height="8" rx="2" class="bat-fill" />
          </svg>
          <span>${pct}</span>
          ${charging ? html`<span class="bolt">⚡</span>` : nothing}
        </div>
      `;
    }

    _renderAlerts(hass, entities) {
      const chips = [];
      if (isOn(hass, entities.error)) chips.push({ cls: "err", label: "Error" });
      if (isOn(hass, entities.lifted)) chips.push({ cls: "warn", label: "Lifted" });
      if (isOn(hass, entities.rain)) chips.push({ cls: "info", label: "Rain delay" });
      if (!chips.length) return nothing;
      return html`
        <div class="alerts">
          ${chips.map((c) => html`<span class="chip ${c.cls}">${c.label}</span>`)}
        </div>
      `;
    }

    _renderProgress(hass, entities, activity) {
      const pct = numState(hass, entities.progress);
      if (pct == null || (activity !== "mowing" && activity !== "returning" && activity !== "paused")) {
        return nothing;
      }
      return html`
        <div class="progress-wrap">
          <div class="progress-label">
            <span>Session</span>
            <span>${Math.round(pct)}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
          </div>
        </div>
      `;
    }

    _renderStats(hass, entities, cfg) {
      const items = [];
      const areaEntity = entities.area || entities.map_area;
      const areaLabel = entities.area ? "Area" : entities.map_area ? "Map" : "Area";
      const areaRaw = textState(hass, areaEntity, "");
      const areaFormatted = areaRaw && areaRaw !== "—" ? formatAreaStat(hass, cfg, areaRaw) : null;
      if (areaEntity && areaFormatted) {
        items.push({ label: areaLabel, value: areaFormatted });
      }
      if (entities.blade) {
        const blade = textState(hass, entities.blade, "—");
        items.push({
          label: "Height",
          value: blade === "—" ? blade : formatBladeHeightStat(hass, cfg, blade),
        });
      }
      if (entities.rtk) {
        items.push({ label: "RTK", value: textState(hass, entities.rtk, "—") });
      }
      const network = textState(hass, entities.network, "").toLowerCase();
      const useLte = /lte|4g|cell|mobile/i.test(network);
      const signalEntity = useLte ? entities.lte || entities.wifi : entities.wifi || entities.lte;
      const signalLabel = useLte && entities.lte ? "4G" : entities.wifi ? "WiFi" : entities.lte ? "4G" : "Signal";
      if (signalEntity) {
        const sig = textState(hass, signalEntity, "—");
        const unit = entityState(hass, signalEntity)?.attributes?.unit_of_measurement;
        items.push({
          label: signalLabel,
          value: sig === "—" || !unit ? sig : `${sig} ${unit}`.trim(),
        });
      }
      if (!items.length) return nothing;
      return html`
        <div class="stats">
          ${items.map(
            (it) => html`
              <div class="stat">
                <span class="stat-label">${it.label}</span>
                <span class="stat-value">${it.value}</span>
              </div>
            `
          )}
        </div>
      `;
    }

    _renderHeadlights(hass, entities) {
      const eid = entities.headlights;
      if (!eid) return nothing;
      const st = entityState(hass, eid);
      const on = st?.state === "on";
      const unavailable = !st || st.state === "unavailable" || st.state === "unknown";
      return html`
        <button
          type="button"
          class="headlights-btn ${on ? "on" : ""}"
          ?disabled=${this._busy || unavailable}
          title=${on ? "Headlights on" : "Headlights off"}
          @click=${() => this._toggleHeadlights(entities)}
        >
          <ha-icon icon="mdi:car-light-high"></ha-icon>
        </button>
      `;
    }

    _renderMowMode(hass, entities) {
      const st = entityState(hass, entities.mow_mode);
      if (!st) return nothing;
      const options = st.attributes?.options || [];
      const current = st.state;
      return html`
        <div class="mow-mode">
          <span class="mode-label">Pattern</span>
          <select
            ?disabled=${this._busy}
            @change=${(ev) => this._setMowMode(entities.mow_mode, ev.target.value)}
          >
            ${options.map(
              (opt) => html`
                <option value=${opt} ?selected=${opt === current}>${opt}</option>
              `
            )}
          </select>
        </div>
      `;
    }

    _renderZonePicker(cfg, entities, showStart) {
      if (cfg.show_zone_picker === false || !showStart) return nothing;
      const zones = this._zoneList(cfg, entities);
      if (!zones.length) return nothing;

      const selected = this._selectedZoneSet();
      const summary = zoneSelectionSummary(selected, zones.length, this._mowAllZones);

      return html`
        <div class="zones">
          <div class="zones-head">
            <span class="zones-label">Mow zones</span>
            <span class="zones-summary">${summary}</span>
          </div>
          <div class="zone-chips">
            <button
              type="button"
              class="zone-chip all ${this._mowAllZones ? "on" : ""}"
              ?disabled=${this._busy}
              @click=${() => this._selectAllZones()}
              title="Start full map (lawn_mower.start_mowing)"
            >
              All
            </button>
            ${zones.map(
              (z) => html`
                <button
                  type="button"
                  class="zone-chip ${!this._mowAllZones && selected.has(z.id) ? "on" : ""}"
                  ?disabled=${this._busy}
                  @click=${() => this._toggleZone(z.id)}
                  title=${z.id}
                >
                  ${z.name}
                </button>
              `
            )}
          </div>
          ${this._mowAllZones
            ? html`<p class="zones-hint">Start mows the full map.</p>`
            : selected.size > 0
              ? html`<p class="zones-hint">Start mows selected zones only.</p>`
              : html`<p class="zones-hint">Select zones to mow, or tap <strong>All</strong> for full map.</p>`}
        </div>
      `;
    }

    _renderZoneShapePanel(label) {
      if (!label) return nothing;
      return html`
        <div class="zone-shape-panel" data-card-version="29" aria-label="Zone shapes">
          <div class="zone-shape-label">${label}</div>
          <canvas class="zone-shape-canvas"></canvas>
        </div>
      `;
    }

    _renderMapZoomOverlay(entities) {
      if (!this._mapZoomOpen || !entities.map) return nothing;
      const st = entityState(this.hass, entities.map);
      const token = st?.attributes?.access_token || "";
      const src = cameraProxyUrl(this.hass, entities.map, token);
      void this._mapTick;
      return html`
        <div
          class="map-zoom-backdrop"
          role="dialog"
          aria-label="Enlarged map"
          @click=${() => {
            this._mapZoomOpen = false;
          }}
        >
          <div class="map-zoom-dialog" @click=${(ev) => ev.stopPropagation()}>
            <button
              type="button"
              class="map-zoom-close"
              aria-label="Close"
              @click=${() => {
                this._mapZoomOpen = false;
              }}
            >
              ×
            </button>
            <img src=${src} alt="Lymow map enlarged" draggable="false" />
          </div>
        </div>
      `;
    }

    _openMapZoom() {
      this._mapZoomOpen = true;
    }

    _renderGeoJsonHero(zoneFeatures, selected, phase, projection) {
      const proj = projection || lymowMapProjection(null, zoneFeatureBounds(zoneFeatures));
      if (!proj) return nothing;
      const hasSelection = selected?.size > 0;
      return html`
        <div class="hero geo-hero ${phase}">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            ${zoneFeatures.map((z) => {
              const on = !hasSelection || zoneIsSelected(z, selected);
              const pts = proj.toPoints(z.ring);
              const [cx, cy] = proj.toPoint(...ringCentroid(z.ring));
              return html`
                ${hasSelection && !on
                  ? html`<polygon points=${pts} class="dimmed"></polygon>`
                  : nothing}
                ${hasSelection && on
                  ? html`
                      <polygon points=${pts} class="zone-glow"></polygon>
                      <polygon points=${pts} class="selected"></polygon>
                      <circle class="zone-check-bg" cx=${cx.toFixed(2)} cy=${cy.toFixed(2)} r="4.2"></circle>
                      <path
                        class="zone-check-mark"
                        d="M ${(cx - 1.8).toFixed(2)} ${cy.toFixed(2)} L ${(cx - 0.4).toFixed(2)} ${(cy + 1.4).toFixed(2)} L ${(cx + 2.2).toFixed(2)} ${(cy - 1.6).toFixed(2)}"
                      ></path>
                    `
                  : nothing}
                ${!hasSelection ? html`<polygon points=${pts} class="idle"></polygon>` : nothing}
                ${hasSelection
                  ? html`
                      <text x=${cx.toFixed(2)} y=${(cy + (on ? 7.5 : 3)).toFixed(2)} class="zone-label ${on ? "on" : ""}">
                        ${z.shortLabel || z.name}
                      </text>
                    `
                  : nothing}
              `;
            })}
          </svg>
          <div class="map-badge">Zone map</div>
        </div>
      `;
    }

    _renderMapHero(entities, phase, mapSize, shapePanel) {
      const st = entityState(this.hass, entities.map);
      const token = st?.attributes?.access_token || "";
      const src = cameraProxyUrl(this.hass, entities.map, token);
      void this._mapTick;
      const showShapePanel = shapePanel?.show;
      return html`
        <div class="hero map-hero map-size-${mapSize} ${phase}">
          <div class="map-stack ${showShapePanel ? "with-shapes" : ""}">
            <div class="map-frame-wrap">
              <div
                class="map-frame zoomable"
                title="Tap to enlarge map"
                @click=${() => this._openMapZoom()}
              >
                <img
                  src=${src}
                  alt="Lymow map"
                  draggable="false"
                  @error=${this._onMapError}
                />
                <span class="map-zoom-hint">Tap to enlarge</span>
              </div>
              <div class="map-badge">Live map</div>
            </div>
            ${showShapePanel ? this._renderZoneShapePanel(shapePanel.label) : nothing}
          </div>
        </div>
      `;
    }

    _renderHero(cfg, entities, activity, phase) {
      const mode = normalizeHeroMode(cfg.hero_mode);
      const mapOn =
        showMapHero(cfg, activity) &&
        entities.map &&
        (mode === "map" || !this._mapFailed);
      const artOn = shouldShowArt(cfg, activity, Boolean(entities.map));
      const img = heroArtPath(cfg, activity);
      const artSrc = mediaUrl(this.hass, img);
      const selected = this._selectedZoneSet();
      const { zones: zoneFeatures, overlayProjection } = this._zoneFeatureData(cfg, entities);
      const shapePanel = this._shapePanelState(cfg, entities, activity, zoneFeatures);
      const zonePickActive = cfg.show_zone_picker !== false && selected.size > 0;
      const showShapePanel = shapePanel.show;
      const mapSize = resolveMapSize(cfg, activity, showShapePanel);
      const artFailed = Boolean(artSrc && this._artFailedSrc === artSrc);

      const useLiveMap =
        entities.map &&
        (mapOn || zonePickActive || showShapePanel || mode === "map" || artFailed) &&
        (mode !== "art" || zonePickActive || showShapePanel) &&
        (mode === "map" || zonePickActive || showShapePanel || !this._mapFailed);

      if (useLiveMap) {
        return this._renderMapHero(entities, phase, mapSize, shapePanel);
      }

      if (artOn && artSrc && !artFailed) {
        return html`
          <div class="hero art-hero ${phase}">
            <img
              src=${artSrc}
              alt=""
              draggable="false"
              @load=${() => {
                if (this._artFailedSrc === artSrc) this._artFailedSrc = null;
              }}
              @error=${(ev) => this._onArtError(ev, artSrc, img)}
            />
          </div>
        `;
      }

      if (!entities.map && zoneFeatures.length && overlayProjection) {
        return this._renderGeoJsonHero(zoneFeatures, selected, phase, overlayProjection);
      }

      return html`<div class="hero empty-hero ${phase}"></div>`;
    }

    _onMapError() {
      const mode = normalizeHeroMode(mergeConfig(this.config).hero_mode);
      if (mode === "map") return;
      this._mapFailed = true;
    }

    _onArtError(ev, src, rawPath) {
      const el = ev.target;
      if (el && !el.dataset?.fallbackTried) {
        const local = String(rawPath || src || "").trim();
        const stripped = String(src || "").replace(/^https?:\/\/[^/]+/i, "");
        const retry = local.startsWith("/") ? local : stripped.startsWith("/") ? stripped : "";
        if (retry && retry !== el.src && retry !== src) {
          el.dataset.fallbackTried = "1";
          el.src = retry;
          return;
        }
      }
      this._artFailedSrc = src;
    }

    _onlineIcon(on) {
      return html`
        <span class="online ${on ? "on" : ""}" title="${on ? "Online" : "Offline"}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4.5 12a7.5 7.5 0 0 1 15 0M7.5 12a4.5 4.5 0 0 1 9 0M12 12v2.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </span>
      `;
    }

    render() {
      if (!this.hass || !this.config) return html``;

      if (isConfigIncomplete(this.config)) {
        return html`
          <ha-card>
            <div class="card setup">
              <p>Choose your <strong>Lymow device</strong> in the card editor (recommended), or set the <strong>Lawn mower</strong> entity.</p>
            </div>
          </ha-card>
        `;
      }

      const cfg = mergeConfig(this.config);
      const entities = resolveEntities(this.hass, cfg);
      const activity = mowerActivity(this.hass, entities);
      const phase = statusPhase(activity, this.hass, entities);
      const features = mowerFeatures(this.hass, entities);
      const charging = isOn(this.hass, entities.charging);
      const online = isOn(this.hass, entities.online);
      const batt = batteryLevel(this.hass, entities);
      const statusLabel = displayStatus(this.hass, entities, activity, this._pending, cfg);
      const title =
        cfg.name ||
        entityState(this.hass, entities.mower)?.attributes?.friendly_name ||
        "Lymow";

      const showPause = canPause(features) && (activity === "mowing" || activity === "returning");
      const showResume = canStart(features) && activity === "paused";
      const showStart = canStart(features) && (activity === "docked" || activity === "error" || activity === "unknown");
      const primaryLabel = showPause
        ? "Pause"
        : showResume
          ? "Resume"
          : this._selectedZoneSet().size > 0
            ? `Start (${this._selectedZoneSet().size})`
            : "Start";
      const primaryAction = showPause ? "pause" : "start_mowing";
      const primaryEnabled =
        showPause || showResume || (showStart && this._hasStartSelection(cfg));

      return html`
        <ha-card>
          <div class="card lm-card phase-${phase} ${this._pending ? "pending" : ""}">
            <div class="header">
              <div class="title-wrap">
                <span class="brand">LYMOW</span>
                <span class="title">${title}</span>
              </div>
              <div class="header-right">
                ${this._renderBattery(batt, charging)}
                ${cfg.show_headlights !== false ? this._renderHeadlights(this.hass, entities) : nothing}
                ${this._onlineIcon(online)}
              </div>
            </div>

            ${this._renderHero(cfg, entities, activity, phase)}
            ${this._renderMapZoomOverlay(entities)}

            <div class="status-row">
              <div class="state-pill ${phase}">
                <span class="dot"></span>
                <span>${statusLabel}</span>
              </div>
            </div>

            ${this._renderAlerts(this.hass, entities)}
            ${this._renderProgress(this.hass, entities, activity)}
            ${cfg.show_stats ? this._renderStats(this.hass, entities, cfg) : nothing}

            ${this._renderZonePicker(cfg, entities, showStart)}

            <div class="actions primary">
              <button
                class="act primary-btn"
                ?disabled=${this._busy || !primaryEnabled}
                @click=${() => this._primaryAction(cfg, entities, primaryAction, showResume)}
              >
                ${primaryLabel}
              </button>
              <button
                class="act dock-btn"
                ?disabled=${this._busy || activity === "docked" || (!canDock(features) && !this._canDockCancel(cfg, entities))}
                @click=${() => this._dockAction(cfg, entities, activity)}
              >
                Dock
              </button>
            </div>

            ${cfg.show_secondary_actions
              ? html`
                  <div class="actions secondary">
                    <button
                      class="act ghost"
                      ?disabled=${this._busy || !this._canCancelTask(cfg, entities)}
                      @click=${() => this._cancelTask(cfg, entities)}
                    >
                      Cancel task
                    </button>
                    <button
                      class="act ghost"
                      ?disabled=${this._busy || !this._canDockCancel(cfg, entities)}
                      @click=${() => this._dockCancelTask(cfg, entities)}
                    >
                      Dock & cancel
                    </button>
                  </div>
                `
              : nothing}

            ${cfg.show_mow_mode ? this._renderMowMode(this.hass, entities) : nothing}
          </div>
        </ha-card>
      `;
    }

    static get styles() {
      return css`
        :host {
          display: block;
        }
        ha-card {
          overflow: hidden;
          background: var(--card-background-color, var(--ha-card-background));
        }
        .card {
          padding: 12px 14px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 220px;
        }
        .setup {
          text-align: center;
          justify-content: center;
          color: var(--primary-text-color);
        }
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .title-wrap {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .brand {
          font-size: 0.62rem;
          letter-spacing: 0.22em;
          font-weight: 700;
          color: #22c55e;
        }
        .title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .headlights-btn {
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--secondary-background-color);
          color: var(--disabled-text-color);
          cursor: pointer;
        }
        .headlights-btn.on {
          color: #fde047;
          background: rgba(253, 224, 71, 0.14);
          box-shadow: 0 0 10px rgba(253, 224, 71, 0.35);
        }
        .headlights-btn.on ha-icon {
          color: #fde047;
        }
        .headlights-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .headlights-btn ha-icon {
          --mdc-icon-size: 20px;
          display: flex;
        }
        .battery {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--secondary-text-color);
        }
        .battery svg {
          width: 34px;
          height: 18px;
        }
        .bat-body,
        .bat-cap {
          fill: none;
          stroke: var(--divider-color, rgba(255, 255, 255, 0.2));
          stroke-width: 1.2;
        }
        .bat-fill {
          fill: #22c55e;
        }
        .battery.low .bat-fill {
          fill: #f59e0b;
        }
        .battery.critical .bat-fill {
          fill: #ef4444;
        }
        .battery.charging .bat-fill {
          fill: #38bdf8;
        }
        .bolt {
          font-size: 0.75rem;
        }
        .online {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--disabled-text-color);
          background: var(--secondary-background-color);
        }
        .online.on {
          color: #22c55e;
          background: rgba(34, 197, 94, 0.14);
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.35);
        }
        .online svg {
          width: 18px;
          height: 18px;
        }
        .hero {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          min-height: 130px;
          background: linear-gradient(
            165deg,
            var(--secondary-background-color) 0%,
            rgba(100, 116, 139, 0.08) 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .hero img {
          width: 100%;
          max-height: 160px;
          object-fit: contain;
          display: block;
          border-radius: 8px;
        }
        .map-hero.hero {
          overflow: visible;
        }
        .map-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .map-stack {
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .map-stack.with-shapes {
          flex-direction: row;
          align-items: flex-start;
          gap: 10px;
          max-width: 340px;
          margin: 0 auto;
        }
        .map-frame-wrap {
          position: relative;
          flex: 0 0 auto;
        }
        .map-frame-wrap .map-badge {
          position: absolute;
          left: 8px;
          bottom: 8px;
          z-index: 2;
        }
        .map-stack.with-shapes .map-frame-wrap {
          width: min(48%, 150px);
        }
        .map-frame {
          position: relative;
          width: min(100%, 160px);
          aspect-ratio: 1;
          max-height: 160px;
        }
        .map-stack.with-shapes .map-frame {
          width: 100%;
          max-height: none;
        }
        .map-frame img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 8px;
        }
        .map-frame.zoomable {
          cursor: zoom-in;
        }
        .map-zoom-hint {
          position: absolute;
          right: 6px;
          top: 6px;
          z-index: 2;
          font-size: 0.55rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.85);
          background: rgba(0, 0, 0, 0.55);
          padding: 2px 6px;
          border-radius: 999px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .map-frame.zoomable:hover .map-zoom-hint,
        .map-frame.zoomable:focus-within .map-zoom-hint {
          opacity: 1;
        }
        .map-hero.map-size-large .map-frame {
          width: min(100%, 240px);
          max-height: 240px;
        }
        .map-hero.map-size-large .map-stack.with-shapes {
          max-width: 520px;
        }
        .map-hero.map-size-large .map-stack.with-shapes .map-frame-wrap,
        .map-hero.map-size-large .zone-shape-panel {
          width: min(48%, 240px);
        }
        .map-hero.map-size-full .map-stack {
          max-width: 100%;
        }
        .map-hero.map-size-full .map-frame {
          width: min(100%, 320px);
          max-height: 320px;
        }
        .map-hero.map-size-full {
          min-height: 200px;
        }
        .map-hero.map-size-large:not(.with-shapes) {
          min-height: 180px;
        }
        .map-zoom-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0, 0, 0, 0.82);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .map-zoom-dialog {
          position: relative;
          max-width: min(96vw, 720px);
          max-height: 96vh;
          width: 100%;
        }
        .map-zoom-dialog img {
          display: block;
          width: 100%;
          max-height: 96vh;
          object-fit: contain;
          border-radius: 12px;
          background: #0f172a;
        }
        .map-zoom-close {
          position: absolute;
          top: -10px;
          right: -10px;
          z-index: 1;
          width: 34px;
          height: 34px;
          border: none;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.95);
          color: #fff;
          font-size: 1.4rem;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        }
        .zone-shape-panel {
          position: relative;
          flex: 0 0 auto;
          width: min(48%, 150px);
          aspect-ratio: 1;
          border-radius: 8px;
          background: #0f172a;
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.35);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .zone-shape-panel canvas.zone-shape-canvas {
          display: block;
          flex: 1 1 auto;
          width: 100%;
          min-height: 0;
        }
        .zone-shape-label {
          position: relative;
          flex: 0 0 auto;
          padding: 5px 4px 2px;
          z-index: 1;
          text-align: center;
          font-size: 0.62rem;
          font-weight: 600;
          color: #bbf7d0;
          pointer-events: none;
        }
        .map-stack.with-shapes .map-badge {
          position: static;
          margin-top: 4px;
          text-align: center;
        }
        .geo-hero .dimmed {
          fill: rgba(0, 0, 0, 0.22);
          stroke: rgba(255, 255, 255, 0.1);
          stroke-width: 0.35;
        }
        .geo-hero {
          background: radial-gradient(circle at 50% 45%, #14532d 0%, #0f172a 72%);
        }
        .geo-hero svg {
          width: 100%;
          max-height: 160px;
          display: block;
        }
        .geo-hero .selected {
          fill: rgba(21, 128, 61, 0.78);
          stroke: #14532d;
          stroke-width: 1.6;
        }
        .geo-hero .zone-glow {
          fill: rgba(22, 101, 52, 0.38);
          stroke: rgba(74, 222, 128, 0.95);
          stroke-width: 2.4;
        }
        .geo-hero .zone-check-bg {
          fill: #14532d;
          stroke: #bbf7d0;
          stroke-width: 0.7;
        }
        .geo-hero .zone-check-mark {
          fill: none;
          stroke: #ffffff;
          stroke-width: 1.3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .geo-hero .zone-label {
          fill: rgba(255, 255, 255, 0.88);
          font-size: 4.5px;
          font-weight: 700;
          text-anchor: middle;
          paint-order: stroke fill;
          stroke: rgba(0, 0, 0, 0.75);
          stroke-width: 0.55;
        }
        .geo-hero .zone-label.on {
          fill: #ffffff;
          font-size: 5px;
        }
        .geo-hero .idle {
          fill: rgba(34, 197, 94, 0.22);
          stroke: rgba(134, 239, 172, 0.45);
          stroke-width: 0.5;
        }
        .map-badge {
          position: absolute;
          left: 8px;
          bottom: 8px;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 600;
          background: rgba(0, 0, 0, 0.55);
          color: #bbf7d0;
        }
        .empty-hero {
          min-height: 130px;
        }
        .phase-mowing .hero {
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.25);
        }
        .grass-track {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 18px;
          background: repeating-linear-gradient(
            90deg,
            rgba(34, 197, 94, 0.15) 0,
            rgba(34, 197, 94, 0.15) 8px,
            rgba(21, 128, 61, 0.22) 8px,
            rgba(21, 128, 61, 0.22) 16px
          );
          animation: grass-slide 1.4s linear infinite;
        }
        @keyframes grass-slide {
          from {
            background-position: 0 0;
          }
          to {
            background-position: 32px 0;
          }
        }
        .status-row {
          display: flex;
          justify-content: center;
        }
        .state-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 0.86rem;
          font-weight: 600;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
        .state-pill .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #64748b;
        }
        .state-pill.mowing .dot,
        .state-pill.returning .dot {
          background: #22c55e;
          animation: pulse 1.6s ease-in-out infinite;
        }
        .state-pill.docked .dot {
          background: #f97316;
        }
        .state-pill.charging .dot {
          background: #22c55e;
          animation: pulse 2s ease-in-out infinite;
        }
        .state-pill.paused .dot {
          background: #eab308;
        }
        .state-pill.error .dot {
          background: #ef4444;
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.55;
            transform: scale(0.85);
          }
        }
        .alerts {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: center;
        }
        .chip {
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .chip.err {
          background: rgba(239, 68, 68, 0.18);
          color: #fca5a5;
        }
        .chip.warn {
          background: rgba(245, 158, 11, 0.18);
          color: #fcd34d;
        }
        .chip.info {
          background: rgba(56, 189, 248, 0.18);
          color: #7dd3fc;
        }
        .progress-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .progress-label {
          display: flex;
          justify-content: space-between;
          font-size: 0.76rem;
          color: var(--secondary-text-color);
        }
        .progress-bar {
          height: 6px;
          border-radius: 999px;
          background: var(--secondary-background-color);
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #16a34a, #4ade80);
          transition: width 0.35s ease;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
          gap: 8px;
        }
        .stat {
          text-align: center;
          padding: 6px 4px;
          border-radius: 8px;
          background: var(--secondary-background-color);
        }
        .stat-label {
          display: block;
          font-size: 0.68rem;
          color: var(--secondary-text-color);
        }
        .stat-value {
          display: block;
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        .act {
          flex: 1;
          border: none;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.86rem;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.15s;
        }
        .act:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .primary-btn {
          background: linear-gradient(180deg, #22c55e, #15803d);
          color: #fff;
        }
        .dock-btn {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        }
        .ghost {
          background: transparent;
          color: var(--secondary-text-color);
          border: 1px dashed var(--divider-color, rgba(255, 255, 255, 0.15));
          font-weight: 600;
        }
        .mow-mode {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mode-label {
          font-size: 0.78rem;
          color: var(--secondary-text-color);
          flex-shrink: 0;
        }
        .mow-mode select {
          flex: 1;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font-size: 0.84rem;
        }
        .pending .primary-btn,
        .pending .dock-btn {
          opacity: 0.7;
        }
        .zones {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .zones-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .zones-label {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--secondary-text-color);
        }
        .zones-summary {
          font-size: 0.72rem;
          color: var(--secondary-text-color);
        }
        .zone-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .zone-chip {
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .zone-chip.on {
          background: rgba(34, 197, 94, 0.22);
          border-color: #22c55e;
          color: #bbf7d0;
        }
        .zone-chip.all.on {
          background: rgba(59, 130, 246, 0.2);
          border-color: #3b82f6;
          color: #bfdbfe;
        }
        .zone-chip:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .zones-hint {
          margin: 0;
          font-size: 0.7rem;
          color: var(--secondary-text-color);
          line-height: 1.35;
        }
      `;
    }
  }

  class LymowCardEditor extends LitElement {
    static get properties() {
      return { hass: {}, config: {} };
    }

    setConfig(config) {
      this.config = mergeConfig(config || {});
    }

    _changed(ev) {
      const value = ev.detail.value || {};
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: {
            config: {
              type: "custom:lymow-card",
              ...value,
              hero_mode: normalizeHeroMode(value.hero_mode),
              units: normalizeUnits(value.units),
              map_size: normalizeMapSize(value.map_size),
            },
          },
        })
      );
    }

    render() {
      if (!this.hass) return html``;
      const data = mergeConfig(this.config || {});
      return html`
        <ha-form
          .hass=${this.hass}
          .data=${data}
          .schema=${[
            {
              name: "device",
              selector: { device: { filter: { integration: "lymow" } } },
            },
            { name: "entity_mower", selector: { entity: { domain: "lawn_mower" } } },
            { name: "entity_status", selector: { entity: { domain: "sensor" } } },
            { name: "entity_battery", selector: { entity: { domain: "sensor" } } },
            { name: "entity_progress", selector: { entity: { domain: "sensor" } } },
            { name: "entity_area", selector: { entity: { domain: "sensor" } } },
            { name: "entity_blade", selector: { entity: { domain: "sensor" } } },
            { name: "entity_rtk", selector: { entity: { domain: "sensor" } } },
            { name: "entity_charging", selector: { entity: { domain: "binary_sensor" } } },
            { name: "entity_headlights", selector: { entity: { domain: "switch" } } },
            { name: "entity_map", selector: { entity: { domain: "camera" } } },
            { name: "entity_map_geojson", selector: { entity: { domain: "sensor" } } },
            { name: "entity_mow_mode", selector: { entity: { domain: "select" } } },
            { name: "entity_online", selector: { entity: { domain: "binary_sensor" } } },
            { name: "entity_error", selector: { entity: { domain: "binary_sensor" } } },
            { name: "entity_btn_cancel", selector: { entity: { domain: "button" } } },
            { name: "entity_btn_dock_cancel", selector: { entity: { domain: "button" } } },
            { name: "name", selector: { text: {} } },
            {
              name: "hero_mode",
              selector: {
                select: {
                  options: [
                    { value: "auto", label: "Auto (map while active, art when docked)" },
                    { value: "map", label: "Always show map camera" },
                    { value: "art", label: "Always show mower/dock artwork" },
                  ],
                },
              },
            },
            {
              name: "units",
              selector: {
                select: {
                  options: [
                    { value: "metric", label: "Metric (m², mm)" },
                    { value: "imperial", label: "Imperial (ft²/ac, in)" },
                    { value: "auto", label: "Auto (follow Home Assistant)" },
                  ],
                },
              },
            },
            { name: "show_map", selector: { boolean: {} } },
            {
              name: "map_size",
              selector: {
                select: {
                  options: [
                    { value: "auto", label: "Auto (larger while mowing, tap to zoom)" },
                    { value: "compact", label: "Compact" },
                    { value: "large", label: "Large" },
                    { value: "full", label: "Full width" },
                  ],
                },
              },
            },
            { name: "show_stats", selector: { boolean: {} } },
            { name: "show_mow_mode", selector: { boolean: {} } },
            { name: "show_zone_picker", selector: { boolean: {} } },
            { name: "show_secondary_actions", selector: { boolean: {} } },
            { name: "show_headlights", selector: { boolean: {} } },
            { name: "image_mower", selector: { text: {} } },
            { name: "image_dock", selector: { text: {} } },
            {
              name: "map_refresh_seconds",
              selector: { number: { min: 10, max: 300, step: 5, mode: "box" } },
            },
          ]}
          .computeLabel=${(s) =>
            ({
              device: "Lymow device (auto-fills entities)",
              entity_mower: "Lawn mower entity",
              entity_status: "Status sensor",
              entity_battery: "Battery sensor",
              entity_progress: "Session progress sensor",
              entity_area: "Session area sensor",
              entity_blade: "Blade height sensor",
              entity_rtk: "RTK GPS sensor",
              entity_charging: "Charging binary sensor",
              entity_headlights: "Headlights switch",
              entity_map: "Map camera",
              entity_map_geojson: "Map GeoJSON sensor (zone list)",
              entity_mow_mode: "Mow mode select",
              entity_online: "Online binary sensor",
              entity_error: "Error binary sensor",
              entity_btn_cancel: "Cancel task button",
              entity_btn_dock_cancel: "Dock & cancel button",
              name: "Card title override",
              hero_mode: "Hero area layout",
              units: "Units for area and blade height",
              show_map: "Auto mode only — show map while mowing",
              map_size: "Live map size (auto enlarges while mowing)",
              show_stats: "Show stats row (area, height, RTK)",
              show_mow_mode: "Show mow pattern selector",
              show_zone_picker: "Show zone picker (Start selected zones)",
              show_secondary_actions: "Show cancel / dock & cancel buttons",
              show_headlights: "Show headlights toggle in header",
              image_mower: "Away image URL — empty dock while mowing (/local/…)",
              image_dock: "Docked image URL — robot on station (/local/…)",
              map_refresh_seconds: "Map refresh interval (seconds)",
            }[s.name] || s.name)}
          @value-changed=${this._changed}
        ></ha-form>
      `;
    }
  }

  customElements.define("lymow-card", LymowCard);
  customElements.define("lymow-card-editor", LymowCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "lymow-card",
    name: "Lymow Card",
    description: "Custom dashboard card for Lymow-HA (One Plus and other Lymow mowers)",
    preview: true,
    documentationURL: "https://github.com/randrcomputers/ha-lymow-card",
  });
})();
