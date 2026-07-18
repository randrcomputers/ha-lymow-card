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
    return c;
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

  function numState(hass, entityId) {
    const st = entityState(hass, entityId);
    if (!st) return null;
    const n = Number(st.state);
    return Number.isFinite(n) ? n : null;
  }

  function textState(hass, entityId, fallback = "—") {
    const st = entityState(hass, entityId);
    if (!st || st.state === "unavailable" || st.state === "unknown") return fallback;
    return String(st.state);
  }

  function resolveEntities(hass, config) {
    const manual = {
      mower: config.entity_mower || null,
      status: config.entity_status || null,
      battery: config.entity_battery || null,
      progress: config.entity_progress || null,
      area: config.entity_area || null,
      blade: config.entity_blade || null,
      rtk: config.entity_rtk || null,
      map: config.entity_map || null,
      mow_mode: config.entity_mow_mode || null,
      online: config.entity_online || null,
      mowing: config.entity_mowing || null,
      charging: config.entity_charging || null,
      error: config.entity_error || null,
      lifted: config.entity_lifted || null,
      rain: config.entity_rain || null,
      btn_cancel: config.entity_btn_cancel || null,
      btn_dock_cancel: config.entity_btn_dock_cancel || null,
    };

    if (!config.device) return manual;

    const devId = config.device;
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
        if (!uid.endsWith(suffix)) continue;
        if (key === "error" && domain !== "binary_sensor") continue;
        if (key === "mower") continue;
        if (hass.states[eid] || key === "map") {
          found[key] = eid;
        }
      }
    }

    return { ...found, ...manual, mower: manual.mower || found.mower };
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

  function showMapHero(cfg, activity) {
    if (!cfg.show_map) return false;
    if (cfg.hero_mode === "map") return true;
    if (cfg.hero_mode === "art") return false;
    return activity === "mowing" || activity === "returning" || activity === "paused";
  }

  function showArtHero(cfg, activity) {
    if (cfg.hero_mode === "art") return true;
    if (cfg.hero_mode === "map") return false;
    return !showMapHero(cfg, activity);
  }

  function batteryLevel(hass, entities) {
    return numState(hass, entities.battery);
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

  class LymowCard extends LitElement {
    static get properties() {
      return {
        hass: {},
        config: {},
        _busy: { state: false },
        _pending: { state: null },
        _mapTick: { state: 0 },
        _mapFailed: { state: false },
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
      return size;
    }

    setConfig(config) {
      this.config = mergeConfig(config);
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

    _renderHero(cfg, entities, activity, phase) {
      const mapOn =
        showMapHero(cfg, activity) && entities.map && !this._mapFailed;
      const artOn = showArtHero(cfg, activity);

      const img =
        activity === "mowing" || activity === "returning" || activity === "paused"
          ? cfg.image_mower
          : cfg.image_dock || cfg.image_mower;
      const artSrc = mediaUrl(this.hass, img);

      if (mapOn) {
        const st = entityState(this.hass, entities.map);
        const token = st?.attributes?.access_token || "";
        const src = cameraProxyUrl(this.hass, entities.map, token);
        void this._mapTick;
        return html`
          <div class="hero map-hero ${phase}">
            <img
              src=${src}
              alt="Lymow map"
              draggable="false"
              @error=${this._onMapError}
            />
            <div class="map-badge">Live map</div>
          </div>
        `;
      }

      if (artOn && artSrc) {
        return html`
          <div class="hero art-hero ${phase}">
            <img
              src=${artSrc}
              alt=""
              draggable="false"
              @error=${(ev) => this._onArtError(ev, artSrc)}
            />
          </div>
        `;
      }

      return html`
        <div class="hero svg-hero ${phase}">
          ${this._mowerSvg(phase)}
        </div>
      `;
    }

    _onMapError() {
      this._mapFailed = true;
    }

    _onArtError(ev, src) {
      const el = ev.target;
      if (el?.dataset?.fallbackTried) {
        el.style.display = "none";
        return;
      }
      // Retry once without hassUrl in case of double-prefix edge cases.
      const raw = String(src || "").replace(/^https?:\/\/[^/]+/i, "");
      if (raw && raw !== src) {
        el.dataset.fallbackTried = "1";
        el.src = raw;
        return;
      }
      el.style.display = "none";
    }

    _mowerSvg(phase) {
      const accent = phase === "error" ? "#ef4444" : phase === "mowing" ? "#22c55e" : "#f97316";
      return html`
        <svg class="mower-svg" viewBox="0 0 240 140" aria-hidden="true">
          <ellipse cx="120" cy="118" rx="72" ry="10" fill="rgba(0,0,0,0.18)" />
          <rect x="52" y="48" width="136" height="58" rx="18" fill="#111827" stroke="${accent}" stroke-width="3" />
          <rect x="68" y="58" width="104" height="18" rx="6" fill="#1f2937" />
          <circle cx="82" cy="112" r="16" fill="#0f172a" stroke="#374151" stroke-width="3" />
          <circle cx="158" cy="112" r="16" fill="#0f172a" stroke="#374151" stroke-width="3" />
          <rect x="108" y="34" width="24" height="18" rx="4" fill="${accent}" opacity="0.9" />
          <path d="M96 48 L120 28 L144 48" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      `;
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
      const batt = batteryLevel(this.hass, entities.battery);
      const statusLabel = displayStatus(this.hass, entities, activity, this._pending, cfg);
      const title =
        cfg.name ||
        entityState(this.hass, entities.mower)?.attributes?.friendly_name ||
        "Lymow";

      const showPause = canPause(features) && (activity === "mowing" || activity === "returning");
      const showResume = canStart(features) && activity === "paused";
      const showStart = canStart(features) && (activity === "docked" || activity === "error" || activity === "unknown");
      const primaryLabel = showPause ? "Pause" : showResume ? "Resume" : "Start";
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

            <div class="actions primary">
              <button
                class="act primary-btn"
                ?disabled=${this._busy || !primaryEnabled}
                @click=${() => this._mowerAction(primaryAction)}
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
        .mower-svg {
          width: min(220px, 90%);
          height: auto;
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
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
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
              entity_mow_mode: "Mow mode select",
              entity_online: "Online binary sensor",
              entity_error: "Error binary sensor",
              entity_btn_cancel: "Cancel task button",
              entity_btn_dock_cancel: "Dock & cancel button",
              name: "Card title override",
              hero_mode: "Hero area layout",
              show_map: "Enable map camera in hero",
              show_stats: "Show stats row (area, height, RTK)",
              show_mow_mode: "Show mow pattern selector",
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
