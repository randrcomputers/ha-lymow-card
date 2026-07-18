/**
 * Lymow Card — Home Assistant Lovelace (Lymow-HA integration).
 * Tailored dashboard card for Lymow One Plus and other Lymow mowers.
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
    map_refresh_seconds: 30,
  });

  const ENTITY_SUFFIXES = {
    mower: "_mower",
    status: "_work_status",
    battery: "_battery",
    progress: "_session_percent",
    area: "_session_area",
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
    btn_cancel: "_btn_cancel_task",
    btn_dock_cancel: "_btn_dock_cancel",
  };

  const ACTIVITY_LABELS = {
    mowing: "Mowing",
    docked: "Docked",
    paused: "Paused",
    returning: "Returning",
    error: "Error",
  };

  function mergeConfig(config) {
    const c = { ...DEFAULTS, ...(config || {}) };
    // UI editor saves empty strings — do not wipe bundled default paths.
    if (!String(c.image_mower || "").trim()) c.image_mower = DEFAULTS.image_mower;
    if (!String(c.image_dock || "").trim()) c.image_dock = DEFAULTS.image_dock;
    c.hero_mode = normalizeHeroMode(c.hero_mode);
    c.show_map = cfgBool(c.show_map, DEFAULTS.show_map);
    return c;
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

  function resolveEntities(hass, config) {
    const manual = {
      mower: normalizeEntityId(config.entity_mower),
      status: normalizeEntityId(config.entity_status),
      battery: normalizeEntityId(config.entity_battery),
      progress: normalizeEntityId(config.entity_progress),
      area: normalizeEntityId(config.entity_area),
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
      btn_cancel: normalizeEntityId(config.entity_btn_cancel),
      btn_dock_cancel: normalizeEntityId(config.entity_btn_dock_cancel),
    };

    if (!config.device) {
      const out = { ...manual };
      out.battery = resolveBatteryEntity(hass, config, out, null);
      return out;
    }

    const devId = normalizeDeviceId(config.device);
    const found = Object.fromEntries(Object.keys(ENTITY_SUFFIXES).map((k) => [k, null]));
    const registry = hass.entities || {};

    for (const [eid, ent] of Object.entries(registry)) {
      if (ent.device_id !== devId) continue;
      const uid = ent.unique_id || "";
      const domain = entityDomain(eid);

      if (!found.mower && domain === "lawn_mower") {
        found.mower = eid;
      }

      for (const [key, suffix] of Object.entries(ENTITY_SUFFIXES)) {
        if (!matchesEntitySuffix(uid, key, suffix)) continue;
        if (key === "error" && domain !== "binary_sensor") continue;
        if (key === "mower") continue;
        if (hass.states[eid] || key === "map") {
          found[key] = eid;
        }
      }
    }

    const merged = { ...found };
    for (const [key, value] of Object.entries(manual)) {
      if (value) merged[key] = value;
    }
    merged.mower = manual.mower || found.mower;
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
    const detail = textState(hass, entities.status, "");
    if (detail && detail !== "—") return detail;
    return ACTIVITY_LABELS[activity] || "Unknown";
  }

  function statusPhase(activity, hass, entities) {
    if (isOn(hass, entities.error)) return "error";
    if (activity === "mowing") return "mowing";
    if (activity === "returning") return "returning";
    if (activity === "paused") return "paused";
    if (isOn(hass, entities.charging) || activity === "docked") return "docked";
    return activity || "idle";
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

  /** Match Lymow-HA build_map_png: uniform scale, PAD, Y-flip. */
  function lymowMapProjection(renderDebug, ringBounds) {
    const W = 100;
    const H = 100;
    const PAD = 5;
    const min_x = renderDebug?.min_x ?? ringBounds?.minX;
    const max_x = renderDebug?.max_x ?? ringBounds?.maxX;
    const min_y = renderDebug?.min_y ?? ringBounds?.minY;
    const max_y = renderDebug?.max_y ?? ringBounds?.maxY;
    if (![min_x, max_x, min_y, max_y].every(Number.isFinite)) return null;
    const scale = (W - PAD * 2) / Math.max(max_x - min_x || 1, max_y - min_y || 1);
    return {
      toPoints(ring) {
        return ring
          .map(([x, y]) => {
            const nx = (x - min_x) * scale + PAD;
            const ny = H - ((y - min_y) * scale + PAD);
            return `${nx.toFixed(2)},${ny.toFixed(2)}`;
          })
          .join(" ");
      },
    };
  }

  function latLonRingToEnu(ring, lat0, lon0) {
    const latRad = (lat0 * Math.PI) / 180;
    return ring.map(([lon, lat]) => {
      const north_m = ((lat - lat0) * Math.PI) / 180 * WGS84_A;
      const east_m = ((lon - lon0) * Math.PI) / 180 * WGS84_A * Math.cos(latRad);
      return [north_m, east_m];
    });
  }

  function ringCoordMode(feature) {
    const crs = feature?.geometry?._crs || feature?.properties?._crs;
    if (crs === "ENU_metres") return "enu";
    return "wgs84";
  }

  /** Zone polygons aligned to Lymow map camera (ENU + render_debug). */
  function loadZoneFeatures(hass, entityId, mapEntityId) {
    const st = entityState(hass, entityId);
    if (!st?.attributes) return { zones: [], projection: null };

    const mapSt = mapEntityId ? entityState(hass, mapEntityId) : null;
    const renderDebug = mapSt?.attributes?.render_debug || null;

    const attrs = st.attributes;
    let features = [];
    if (attrs.geojson_zones?.features) {
      features = attrs.geojson_zones.features;
    } else if (attrs.geojson?.features) {
      features = attrs.geojson.features;
    }

    const ebp = attrs.enu_base_point || {};
    const lat0 = Number(ebp.latitude);
    const lon0 = Number(ebp.longitude);
    const hasOrigin =
      attrs.has_gps_origin && Number.isFinite(lat0) && Number.isFinite(lon0);

    const zones = [];
    const seen = new Set();
    for (const f of features) {
      const p = f?.properties || {};
      if (p.type && p.type !== "zone") continue;
      const id = p.hashId || p.hash_id || p.id;
      if (!id || seen.has(id)) continue;
      const geom = f.geometry;
      if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]?.length) continue;

      let ring = geom.coordinates[0]
        .map((pt) => [Number(pt[0]), Number(pt[1])])
        .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
      if (ring.length < 3) continue;

      if (hasOrigin && ringCoordMode(f) !== "enu") {
        ring = latLonRingToEnu(ring, lat0, lon0);
      }

      seen.add(id);
      const index = zones.length;
      const name = zoneDisplayName(p, String(id), index);
      zones.push({ id: String(id), name, index, ring });
    }

    zones.sort((a, b) => {
      const na = a.name.match(/^Zone\s+(\d+)$/i);
      const nb = b.name.match(/^Zone\s+(\d+)$/i);
      if (na && nb) return Number(na[1]) - Number(nb[1]);
      return a.index - b.index;
    });

    const projection = lymowMapProjection(renderDebug, zoneFeatureBounds(zones));
    return { zones, projection };
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
    return { minX, minY, width, height, pad: 4 };
  }

  /** Zone list from Map GeoJSON sensor (Lymow-HA). */
  function loadZones(hass, entityId, mapEntityId) {
    return loadZoneFeatures(hass, entityId, mapEntityId).zones.map(({ id, name, index }) => ({
      id,
      name,
      index,
    }));
  }

  function zoneSelectionSummary(selected, total) {
    if (!selected?.size) return "All zones";
    if (selected.size === 1) return "1 zone selected";
    if (selected.size === total) return "All zones";
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
        _selectedZones: { state: null },
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

    _toggleZone(zoneId) {
      const next = new Set(this._selectedZoneSet());
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      this._selectedZones = next;
    }

    _clearZoneSelection() {
      this._selectedZones = new Set();
    }

    connectedCallback() {
      super.connectedCallback();
      this._startMapTimer();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._stopMapTimer();
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
        } else {
          await this._call("lawn_mower", "start_mowing", { entity_id: entities.mower });
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

    _renderStats(hass, entities) {
      const area = textState(hass, entities.area, "");
      const blade = textState(hass, entities.blade, "");
      const rtk = textState(hass, entities.rtk, "");
      const items = [];
      if (area && area !== "—") items.push({ label: "Area", value: `${area} m²` });
      if (blade && blade !== "—") items.push({ label: "Height", value: `${blade} mm` });
      if (rtk && rtk !== "—") items.push({ label: "RTK", value: rtk });
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
      const summary = zoneSelectionSummary(selected, zones.length);

      return html`
        <div class="zones">
          <div class="zones-head">
            <span class="zones-label">Mow zones</span>
            <span class="zones-summary">${summary}</span>
          </div>
          <div class="zone-chips">
            <button
              type="button"
              class="zone-chip all ${selected.size === 0 ? "on" : ""}"
              ?disabled=${this._busy}
              @click=${() => this._clearZoneSelection()}
              title="Start full map (lawn_mower.start_mowing)"
            >
              All
            </button>
            ${zones.map(
              (z) => html`
                <button
                  type="button"
                  class="zone-chip ${selected.has(z.id) ? "on" : ""}"
                  ?disabled=${this._busy}
                  @click=${() => this._toggleZone(z.id)}
                  title=${z.id}
                >
                  ${z.name}
                </button>
              `
            )}
          </div>
          ${selected.size > 0
            ? html`<p class="zones-hint">Start mows selected zones only.</p>`
            : html`<p class="zones-hint">Pick zones, or leave <strong>All</strong> for full map.</p>`}
        </div>
      `;
    }

    _renderZoneHighlightSvg(zoneFeatures, selected, projection) {
      if (!selected?.size || !zoneFeatures?.length || !projection) return nothing;
      const picked = zoneFeatures.filter((z) => selected.has(z.id));
      if (!picked.length) return nothing;
      return html`
        <svg class="zone-overlay" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          ${picked.map((z) => {
            const pts = projection.toPoints(z.ring);
            return html`
              <polygon points=${pts} class="selected-glow"></polygon>
              <polygon points=${pts} class="selected"></polygon>
            `;
          })}
        </svg>
      `;
    }

    _renderGeoJsonHero(zoneFeatures, selected, phase, projection) {
      const proj =
        projection ||
        lymowMapProjection(null, zoneFeatureBounds(zoneFeatures));
      if (!proj) return nothing;
      const hasSelection = selected?.size > 0;
      return html`
        <div class="hero geo-hero ${phase}">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            ${zoneFeatures.map((z) => {
              const on = !hasSelection || selected.has(z.id);
              const pts = proj.toPoints(z.ring);
              return html`
                <polygon
                  points=${pts}
                  class=${on && hasSelection ? "selected" : hasSelection ? "dimmed" : "idle"}
                ></polygon>
              `;
            })}
          </svg>
          <div class="map-badge">Zone map</div>
        </div>
      `;
    }

    _renderMapHero(entities, phase, zoneFeatures, selected, projection, highlightZones) {
      const st = entityState(this.hass, entities.map);
      const token = st?.attributes?.access_token || "";
      const src = cameraProxyUrl(this.hass, entities.map, token);
      void this._mapTick;
      return html`
        <div class="hero map-hero ${phase}">
          <div class="map-stack">
            <img
              src=${src}
              alt="Lymow map"
              draggable="false"
              @error=${this._onMapError}
            />
            ${highlightZones
              ? this._renderZoneHighlightSvg(zoneFeatures, selected, projection)
              : nothing}
          </div>
          <div class="map-badge">Live map</div>
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
      const { zones: zoneFeatures, projection } = this._zoneFeatureData(cfg, entities);
      const highlightZones =
        cfg.show_zone_picker !== false &&
        selected.size > 0 &&
        zoneFeatures.length > 0 &&
        projection;
      const artFailed = Boolean(artSrc && this._artFailedSrc === artSrc);

      // Prefer live map (+ zone overlay) whenever the map camera exists.
      const useLiveMap =
        entities.map &&
        (mapOn || highlightZones || mode === "map" || artFailed) &&
        (mode !== "art" || highlightZones) &&
        (mode === "map" || highlightZones || !this._mapFailed);

      if (useLiveMap) {
        return this._renderMapHero(
          entities,
          phase,
          zoneFeatures,
          selected,
          projection,
          highlightZones
        );
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

      // GeoJSON schematic only when there is no map camera at all.
      if (!entities.map && zoneFeatures.length && projection) {
        return this._renderGeoJsonHero(zoneFeatures, selected, phase, projection);
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
      const primaryEnabled = showPause || showResume || showStart;

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
                ${this._onlineIcon(online)}
              </div>
            </div>

            ${this._renderHero(cfg, entities, activity, phase)}

            <div class="status-row">
              <div class="state-pill ${phase}">
                <span class="dot"></span>
                <span>${statusLabel}</span>
              </div>
            </div>

            ${this._renderAlerts(this.hass, entities)}
            ${this._renderProgress(this.hass, entities, activity)}
            ${cfg.show_stats ? this._renderStats(this.hass, entities) : nothing}

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
                ?disabled=${this._busy || !canDock(features) || activity === "docked"}
                @click=${() => this._mowerAction("dock")}
              >
                Dock
              </button>
            </div>

            ${cfg.show_secondary_actions
              ? html`
                  <div class="actions secondary">
                    <button
                      class="act ghost"
                      ?disabled=${this._busy || !entities.btn_cancel}
                      @click=${() => this._pressButton(entities.btn_cancel)}
                    >
                      Cancel task
                    </button>
                    <button
                      class="act ghost"
                      ?disabled=${this._busy || !entities.btn_dock_cancel}
                      @click=${() => this._pressButton(entities.btn_dock_cancel)}
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
        .map-stack {
          display: grid;
          width: 100%;
          max-height: 160px;
          place-items: center;
        }
        .map-stack > img,
        .map-stack > svg {
          grid-area: 1 / 1;
          width: 100%;
          max-height: 160px;
        }
        .map-stack img {
          object-fit: contain;
          display: block;
          border-radius: 8px;
          z-index: 1;
        }
        .zone-overlay {
          z-index: 2;
          pointer-events: none;
          overflow: visible;
        }
        .zone-overlay .selected-glow {
          fill: rgba(250, 204, 21, 0.25);
          stroke: rgba(254, 240, 138, 0.9);
          stroke-width: 3;
        }
        .zone-overlay .selected {
          fill: rgba(250, 204, 21, 0.5);
          stroke: #fff;
          stroke-width: 1.4;
        }
        .zone-overlay .dimmed,
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
          fill: rgba(250, 204, 21, 0.5);
          stroke: #fef9c3;
          stroke-width: 1.4;
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
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
            { name: "show_map", selector: { boolean: {} } },
            { name: "show_stats", selector: { boolean: {} } },
            { name: "show_mow_mode", selector: { boolean: {} } },
            { name: "show_zone_picker", selector: { boolean: {} } },
            { name: "show_secondary_actions", selector: { boolean: {} } },
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
              entity_map: "Map camera",
              entity_map_geojson: "Map GeoJSON sensor (zone list)",
              entity_mow_mode: "Mow mode select",
              entity_online: "Online binary sensor",
              entity_error: "Error binary sensor",
              entity_btn_cancel: "Cancel task button",
              entity_btn_dock_cancel: "Dock & cancel button",
              name: "Card title override",
              hero_mode: "Hero area layout",
              show_map: "Auto mode only — show map while mowing",
              show_stats: "Show stats row (area, height, RTK)",
              show_mow_mode: "Show mow pattern selector",
              show_zone_picker: "Show zone picker (Start selected zones)",
              show_secondary_actions: "Show cancel / dock & cancel buttons",
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
