// ============================================================
// api/routes.js
//
// A standalone, read-only REST layer over the static /api resource
// tree (tools/build_api.py's output). Deliberately isolated from
// server.js's existing Build Dashboard / Guides endpoints: this file
// is required and mounted with ONE line --
//   app.use("/api", require("./api/routes")(PROJECT_ROOT));
// -- and touches nothing else in server.js. If this file is deleted,
// the rest of the app (dashboard, guides, static site) is unaffected.
//
// DESIGN, following REST + MCP-tool conventions:
//   - GET-only: this is a read surface over generated data, not a
//     mutation API. (Guides' create/edit/delete already live in
//     server.js's own routes, unrelated to this file.)
//   - Resource-oriented URIs: /api/{collection}/{id}, plural
//     collection names, singular item routes for single-record fetch
//     (/api/weapon/:id) alongside the plural list route
//     (/api/weapons) -- matching the shape requested when this API
//     was scoped.
//   - Consistent envelope: every response is { data, meta } where
//     meta carries at least { count } for collections, so a caller
//     (or an MCP tool wrapper) never has to guess whether the root
//     is an array or an object.
//   - Consistent error shape: { error: { code, message } } with the
//     matching HTTP status, never a bare string or stack trace.
//   - Every route degrades to 200 + empty data (never a crash) if the
//     underlying /api JSON hasn't been generated yet -- with a clear
//     message pointing at `python3 tools/build_api.py`.
//   - No caching layer: files are small and local; each request reads
//     fresh from disk so a re-run of build_api.py is reflected
//     immediately without restarting the server.
//
// Full documentation of every route, the envelope, and the MCP tool
// mapping lives in APIRouting.md at the project root.
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

module.exports = function createApiRouter(projectRoot) {
  const router = express.Router();
  const API_DIR = path.join(projectRoot, "api");

  function readJson(relPath) {
    const full = path.join(API_DIR, relPath);
    if (!fs.existsSync(full)) return null;
    try {
      return JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (e) {
      return null;
    }
  }

  function notBuilt(res) {
    return res.status(200).json({
      data: [],
      meta: { count: 0, warning: "api/ has not been generated yet -- run: python3 tools/build_api.py" },
    });
  }

  function sendCollection(res, relPath, filterFn) {
    const data = readJson(relPath);
    if (data === null) return notBuilt(res);
    const filtered = filterFn ? data.filter(filterFn) : data;
    res.json({ data: filtered, meta: { count: filtered.length } });
  }

  function sendById(res, relPath, idField, idValue, coerceNumber) {
    const data = readJson(relPath);
    if (data === null) return notBuilt(res);
    const target = coerceNumber ? Number(idValue) : idValue;
    const found = data.find((r) => r[idField] === target || String(r[idField]) === String(idValue));
    if (!found) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: `No record with ${idField}=${idValue}` } });
    }
    res.json({ data: found, meta: {} });
  }

  // ---- Discovery root: MCP-style capability listing ----
  router.get("/", (req, res) => {
    const meta = readJson("_meta.json");
    res.json({
      data: {
        schemaVersion: meta ? meta.schemaVersion : null,
        generatedAt: meta ? meta.generatedAt : null,
        endpoints: [
          "GET /api/search?q=",
          "GET /api/items", "GET /api/item/:id",
          "GET /api/weapons", "GET /api/weapon/:id",
          "GET /api/armor", "GET /api/armor/:id",
          "GET /api/monsters", "GET /api/monster/:id",
          "GET /api/skills",
          "GET /api/localization",
          "GET /api/datatables", "GET /api/datatable/:name",
          "GET /api/structs", "GET /api/struct/:id",
          "GET /api/functions", "GET /api/function/:blueprint",
          "GET /api/tutorials", "GET /api/tutorial/:name",
        ],
        docs: "See APIRouting.md at the project root for the full spec.",
      },
      meta: {},
    });
  });

  // ---- Items ----
  router.get("/items", (req, res) => {
    const weapons = readJson("items/weapons.json") || [];
    const armor = readJson("items/armor.json") || [];
    const accessories = readJson("items/accessories.json") || [];
    const all = [...weapons, ...armor, ...accessories];
    res.json({ data: all, meta: { count: all.length } });
  });

  router.get("/item/:id", (req, res) => {
    const { id } = req.params;
    const collections = ["items/weapons.json", "items/armor.json", "items/accessories.json"];
    for (const rel of collections) {
      const data = readJson(rel);
      if (!data) continue;
      const found = data.find((r) => String(r.id) === id || r.itemKey === id);
      if (found) return res.json({ data: found, meta: {} });
    }
    res.status(404).json({ error: { code: "NOT_FOUND", message: `No item with id or itemKey "${id}"` } });
  });

  router.get("/weapons", (req, res) => {
    const cat = req.query.category;
    sendCollection(res, "items/weapons.json", cat ? (r) => r.category === cat : null);
  });
  router.get("/weapon/:id", (req, res) => sendById(res, "items/weapons.json", "id", req.params.id, true));

  router.get("/armor", (req, res) => {
    const cat = req.query.category;
    sendCollection(res, "items/armor.json", cat ? (r) => r.category === cat : null);
  });
  router.get("/armor/:id", (req, res) => sendById(res, "items/armor.json", "id", req.params.id, true));

  // ---- Monsters ----
  router.get("/monsters", (req, res) => {
    const cat = req.query.category;
    sendCollection(res, "monsters/monsters.json", cat ? (r) => r.monsterCategory === cat : null);
  });
  router.get("/monster/:id", (req, res) => {
    const { id } = req.params;
    const monsters = readJson("monsters/monsters.json");
    const stats = readJson("monsters/stats.json") || [];
    if (!monsters) return notBuilt(res);
    const found = monsters.find((m) => String(m.titleId) === id || m.titleKey === id);
    if (!found) return res.status(404).json({ error: { code: "NOT_FOUND", message: `No monster with id or titleKey "${id}"` } });
    // Enrich with Blueprint stats when the enemy code is derivable --
    // a convenience join, not a new data source. Monster records don't
    // carry an enemyCode field directly; the confirmed link is
    // titleKey "EnemyName_{6 digits}" <-> Blueprint code "E{6 digits}"
    // (the same rule build_monster_spawns/build_monster_stats use).
    const codeMatch = /^EnemyName_(\d{6})$/.exec(found.titleKey || "");
    const derivedCode = codeMatch ? `E${codeMatch[1]}` : null;
    const statEntry = derivedCode ? stats.find((s) => s.code === derivedCode) : null;
    res.json({ data: { ...found, stats: statEntry || null }, meta: {} });
  });

  // ---- Skills ----
  router.get("/skills", (req, res) => {
    const active = readJson("skills/active_skills.json") || [];
    const sword = readJson("skills/sword_skills.json") || [];
    res.json({ data: { activeSkills: active, swordSkills: sword }, meta: { count: active.length + sword.length } });
  });

  // ---- Localization ----
  router.get("/localization", (req, res) => sendCollection(res, "localization/languages.json"));

  // ---- Datatables / Structs / Functions (reverse-engineering reference) ----
  router.get("/datatables", (req, res) => sendCollection(res, "datatables/_index.json"));
  router.get("/datatable/:name", (req, res) => {
    const data = readJson("datatables/_index.json");
    if (!data) return notBuilt(res);
    const found = data.find((t) => t.name.toLowerCase() === req.params.name.toLowerCase());
    if (!found) return res.status(404).json({ error: { code: "NOT_FOUND", message: `No DataTable named "${req.params.name}"` } });
    res.json({ data: found, meta: {} });
  });

  router.get("/structs", (req, res) => sendCollection(res, "structs/_index.json"));
  router.get("/struct/:id", (req, res) => sendById(res, "structs/_index.json", "structId", req.params.id, false));

  router.get("/functions", (req, res) => sendCollection(res, "functions/_index.json"));
  router.get("/function/:blueprint", (req, res) => {
    const data = readJson("functions/_index.json");
    if (!data) return notBuilt(res);
    const found = data.find((f) => f.blueprint.toLowerCase() === req.params.blueprint.toLowerCase());
    if (!found) return res.status(404).json({ error: { code: "NOT_FOUND", message: `No Blueprint named "${req.params.blueprint}" (gameplay Blueprints are not indexed here -- see APIRouting.md)` } });
    res.json({ data: found, meta: {} });
  });

  // ---- Tutorials ----
  router.get("/tutorials", (req, res) => {
    const dir = path.join(API_DIR, "tutorials");
    if (!fs.existsSync(dir)) return notBuilt(res);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    res.json({ data: files.map((f) => f.replace(/\.md$/, "")), meta: { count: files.length } });
  });
  router.get("/tutorial/:name", (req, res) => {
    const full = path.join(API_DIR, "tutorials", `${req.params.name}.md`);
    if (!fs.existsSync(full)) return res.status(404).json({ error: { code: "NOT_FOUND", message: `No tutorial named "${req.params.name}"` } });
    res.json({ data: { name: req.params.name, content: fs.readFileSync(full, "utf-8") }, meta: {} });
  });

  // ---- Search: simple substring match across name/key/label fields
  // in every collection. Deliberately basic (no fuzzy/ranked search)
  // -- documented as a known limitation in APIRouting.md rather than
  // faking relevance scoring this data doesn't support. ----
  router.get("/search", (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Missing required query parameter: q" } });

    const sources = [
      ["weapon", "items/weapons.json", ["itemKey", "category"]],
      ["armor", "items/armor.json", ["itemKey", "category"]],
      ["item", "items/accessories.json", ["itemKey", "itemCategory"]],
      ["monster", "monsters/monsters.json", ["titleKey", "enemyTypeLabel"]],
      ["datatable", "datatables/_index.json", ["name"]],
      ["struct", "structs/_index.json", ["structId"]],
      ["function", "functions/_index.json", ["blueprint"]],
    ];
    const results = [];
    for (const [type, rel, fields] of sources) {
      const data = readJson(rel);
      if (!data) continue;
      for (const row of data) {
        const hay = fields.map((f) => String(row[f] || "")).join(" ").toLowerCase();
        if (hay.includes(q)) results.push({ resourceType: type, ...row });
        if (results.length >= 200) break; // hard cap -- documented in APIRouting.md
      }
    }
    res.json({ data: results, meta: { count: results.length, query: q, capped: results.length >= 200 } });
  });

  return router;
};
