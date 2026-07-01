// ============================================================
// server.js
// Minimal Express static server for the ROD Database Toolkit.
//
// This exists because the app's data-loader.js uses fetch() to pull
// in Content/ROD/*.json and *.png at runtime -- browsers block fetch()
// on file:// URLs, so the app folder has to be served over HTTP even
// in production. There's no API, no database, no build step: this
// just serves the static files (index.html, app/, Content/) and lets
// the browser do the rest.
//
// Listens on PORT (default 8000) on 0.0.0.0 so it's reachable from
// outside the container -- matches the Dockge compose mapping of
// "8990:8000".
//
// Build Dashboard API (added alongside the static server): a small
// set of endpoints that let the Build Dashboard view (a) check the
// real pipeline's status by running tools/build_pipeline.py --status
// and relaying its JSON output, (b) accept an uploaded ZIP or loose
// JSON file(s) into raw-export/, and (c) trigger a real (full or
// partial) pipeline rebuild and stream its output back. These
// endpoints shell out to the SAME tools/build_pipeline.py the rest of
// this project already uses -- nothing here reimplements pipeline
// logic; it's a thin control surface over the existing script.
//
// TRUST NOTE: these endpoints execute Python and unzip on the host
// machine in response to browser requests. That's an acceptable
// surface for a local-only developer tool like this one, but would
// NOT be safe to expose on a public-facing deployment as-is -- there
// is no auth, no path sanitization beyond what's described inline
// below, and no rate limiting.
// ============================================================

const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8000;
const PROJECT_ROOT = __dirname;
const RAW_EXPORT_ROOT = path.join(PROJECT_ROOT, "raw-export", "Content", "ROD");
const PIPELINE_SCRIPT = path.join(PROJECT_ROOT, "tools", "build_pipeline.py");
const UPLOAD_TMP_DIR = path.join(PROJECT_ROOT, ".upload-tmp");
// Versioned USMAP/IDA mapping files, populated entirely OUTSIDE this app
// (no upload UI for these -- placed directly on the backend filesystem by
// whoever manages the server), auto-detected by folder structure:
//   mapping-files/{major:8}/{minor:8}/{patch:8}/{build:8}/{usmap|ida}/<file>
// e.g. version 1.2.4.1's IDA file lives at
//   mapping-files/00000001/00000002/00000004/00000001/ida/<file>
const MAPPING_FILES_ROOT = path.join(PROJECT_ROOT, "mapping-files");
const MAPPING_FILE_TYPES = ["usmap", "ida"]; // the only two subfolder names ever trusted -- prevents path-traversal via an arbitrary ?type= value

// Accept raw binary bodies up to 500MB for ZIP uploads, and JSON
// bodies for loose-file uploads (sent as { filename, content } pairs
// rather than multipart, so no new npm dependency like multer is
// needed -- the browser reads File objects as text/arrayBuffer and
// posts plain JSON, which express.json() already handles).
app.use("/api/pipeline/upload-zip", express.raw({ type: "application/zip", limit: "500mb" }));
app.use(express.json({ limit: "50mb" }));

/**
 * Runs tools/build_pipeline.py with the given CLI args and resolves
 * with { code, stdout, stderr }. Used by both the status and rebuild
 * endpoints -- the only difference between them is which args get
 * passed and whether output is parsed as JSON or streamed as text.
 */
function runPipeline(args) {
  return new Promise((resolve) => {
    const proc = spawn("python3", [PIPELINE_SCRIPT, ...args], { cwd: PROJECT_ROOT });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Lists sub-directory names of `dirPath` that are exactly 8 digits
 * (the zero-padded version-segment convention), returned as integers.
 * Anything else present (a stray file, a non-numeric folder someone
 * dropped in by mistake) is silently ignored rather than crashing --
 * this whole tree is populated by hand outside the app, so it should
 * tolerate being a little messy without breaking detection.
 */
function listVersionSegments(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => /^\d{8}$/.test(name) && fs.statSync(path.join(dirPath, name)).isDirectory())
    .map((name) => parseInt(name, 10))
    .sort((a, b) => b - a); // descending -- search highest version first
}

const pad8 = (n) => String(n).padStart(8, "0");

/**
 * The real game export's own Content.zip has Localization/ and
 * WwiseAudio/ as SIBLINGS of ROD/ under Content/ (confirmed directly
 * by inspecting the actual zip: Content/Localization/, Content/ROD/,
 * Content/WwiseAudio/ are the only three top-level folders) -- NOT
 * nested inside ROD/ the way raw-export/ (and therefore this
 * pipeline's SRC constant) expects. Extracting the zip as-is
 * therefore lands those two subtrees one level away from where every
 * localization-dependent section actually looks for them
 * (raw-export/Content/Localization/... instead of the expected
 * raw-export/Content/ROD/Localization/...) -- they silently show as
 * "missing" in the status check even though the real files ARE on
 * disk, just at the wrong relative path.
 *
 * This merges each misplaced sibling into its correct location under
 * Content/ROD/ after extraction. A MERGE, not an overwriting rename,
 * because a partial raw-export/ (some Localization data already
 * correctly in place from an earlier upload) shouldn't have that
 * existing data silently clobbered by shelling out to `cp -r` with
 * trailing slashes (copies the SOURCE folder's CONTENTS into the
 * destination, creating it if needed, rather than nesting a second
 * copy of the folder itself inside the destination).
 */
function mergeMisplacedContentSiblings(extractRoot) {
  const contentRoot = path.join(extractRoot, "Content");
  const rodRoot = path.join(contentRoot, "ROD");
  const moved = [];
  if (!fs.existsSync(rodRoot)) return moved; // no Content/ROD/ at all -- nothing to merge into, the earlier validation already would have rejected this zip anyway

  for (const name of ["Localization", "WwiseAudio"]) {
    const misplacedPath = path.join(contentRoot, name);
    const correctPath = path.join(rodRoot, name);
    if (misplacedPath === correctPath) continue;
    if (!fs.existsSync(misplacedPath) || !fs.statSync(misplacedPath).isDirectory()) continue;

    fs.mkdirSync(correctPath, { recursive: true });
    // `cp -r src/. dest/` copies src's CONTENTS into dest (creating
    // dest if needed) rather than nesting src itself one level deeper
    // inside dest -- the trailing "/." is what makes this a content
    // merge instead of a "copy the folder itself" operation.
    // NOT path.join(misplacedPath, ".") -- path.join() normalizes away
    // a trailing "." entirely (confirmed: path.join("/a/b", ".") ===
    // "/a/b", not "/a/b/."), which silently defeats the exact `cp -r
    // src/. dst` content-merge idiom this needs. Without that trailing
    // dot, `cp -r src dst` copies src ITSELF as a nested subdirectory
    // of dst -- this was the actual, confirmed cause of a real
    // WwiseAudio double-nesting bug (raw-export/Content/ROD/WwiseAudio/
    // WwiseAudio/Events/... instead of .../WwiseAudio/Events/...),
    // caught by testing against the real 332MB Content.zip end-to-end
    // rather than trusting the smaller mock test case that happened
    // not to expose it.
    const cpArg = `${misplacedPath}/.`;
    const cpResult = require("child_process").spawnSync("cp", ["-r", cpArg, correctPath]);
    if (cpResult.status === 0) {
      fs.rmSync(misplacedPath, { recursive: true, force: true });
      moved.push(name);
    }
  }
  return moved;
}

/**
 * Walks mapping-files/{major}/{minor}/{patch}/{build}/{type}/ from the
 * highest version downward and returns the first one that actually
 * has a file in it -- NOT just the highest-numbered folder that
 * exists, since a version folder can exist (created ahead of time)
 * without yet having a file dropped into it for this specific type.
 * usmap and ida are searched independently, since one type's latest
 * version can genuinely be newer than the other's.
 * Returns { version, filename, fullPath } or null if nothing found.
 */
function findLatestMappingFile(type) {
  if (!MAPPING_FILE_TYPES.includes(type)) return null;
  for (const major of listVersionSegments(MAPPING_FILES_ROOT)) {
    const majorPath = path.join(MAPPING_FILES_ROOT, pad8(major));
    for (const minor of listVersionSegments(majorPath)) {
      const minorPath = path.join(majorPath, pad8(minor));
      for (const patch of listVersionSegments(minorPath)) {
        const patchPath = path.join(minorPath, pad8(patch));
        for (const build of listVersionSegments(patchPath)) {
          const buildPath = path.join(patchPath, pad8(build));
          const typePath = path.join(buildPath, type);
          if (!fs.existsSync(typePath) || !fs.statSync(typePath).isDirectory()) continue;
          const files = fs.readdirSync(typePath).filter((f) => fs.statSync(path.join(typePath, f)).isFile());
          if (files.length === 0) continue; // version folder exists but nothing's been dropped in yet -- keep searching downward
          // If more than one file somehow ended up in the same version/type
          // folder (not the intended convention, but handled gracefully
          // rather than erroring), the most recently modified one wins.
          files.sort((a, b) => fs.statSync(path.join(typePath, b)).mtimeMs - fs.statSync(path.join(typePath, a)).mtimeMs);
          return {
            version: `${major}.${minor}.${patch}.${build}`,
            filename: files[0],
            fullPath: path.join(typePath, files[0]),
          };
        }
      }
    }
  }
  return null;
}

/**
 * GET /api/pipeline/status
 * Runs `build_pipeline.py --status` and relays its JSON output
 * directly -- this endpoint does NOT recompute or duplicate any
 * export-check/schema-check/overview logic itself; get_pipeline_status()
 * in the Python pipeline is the single source of truth for what each
 * section needs, whether it currently builds, and the 4-phase overview
 * summary (folder structure, schema validity, generated data points)
 * the dashboard's top-of-page panel reads. The Python side already
 * returns the exact { sections, overview } shape the client expects,
 * so this just passes it through -- no re-wrapping.
 */
app.get("/api/pipeline/status", async (req, res) => {
  const result = await runPipeline(["--status"]);
  if (result.code !== 0) {
    return res.status(500).json({ error: "Pipeline status check failed to run", stderr: result.stderr });
  }
  try {
    const data = JSON.parse(result.stdout);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Pipeline returned non-JSON output", raw: result.stdout.slice(0, 2000) });
  }
});

/**
 * POST /api/pipeline/rebuild
 * Body: { onlyKey?: string, fromKey?: string } -- both optional; with
 * neither, runs the full pipeline (same as `python3 build_pipeline.py`
 * with no flags). Streams nothing fancy -- runs to completion, then
 * returns the full stdout/stderr and exit code in one response, since
 * a full rebuild only takes a few seconds (confirmed throughout this
 * project's own development).
 */
app.post("/api/pipeline/rebuild", async (req, res) => {
  const { onlyKey, fromKey } = req.body || {};
  const args = [];
  if (onlyKey) args.push(`--only=${onlyKey}`);
  else if (fromKey) args.push(`--from=${fromKey}`);

  const result = await runPipeline(args);
  res.json({ ok: result.code === 0, exitCode: result.code, stdout: result.stdout, stderr: result.stderr });
});

/**
 * POST /api/pipeline/upload-zip
 * Body: raw ZIP bytes (Content-Type: application/zip).
 * Validates the archive actually contains a Content/ROD/ folder
 * structure (the same shape every previous content upload in this
 * project has had) BEFORE extracting anything -- a ZIP that doesn't
 * match this shape is rejected with a clear error rather than
 * extracted into the wrong place. On success, extracts into
 * raw-export/ (which already contains Content/ROD/, so files land at
 * the same relative paths the pipeline already expects) and reports
 * which files were added/changed.
 */
app.post("/api/pipeline/upload-zip", async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "No ZIP data received" });
  }

  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const zipPath = path.join(UPLOAD_TMP_DIR, `upload-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, req.body);

  try {
    // Validate structure first: list the ZIP's contents without
    // extracting (unzip -l), and require at least one entry under
    // Content/ROD/ -- this is the check the user specifically asked
    // for ("validates the folder structure exists before copying").
    const listResult = await new Promise((resolve) => {
      const proc = spawn("unzip", ["-l", zipPath]);
      let out = "";
      proc.stdout.on("data", (d) => { out += d.toString(); });
      proc.on("close", (code) => resolve({ code, out }));
    });

    if (listResult.code !== 0) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ error: "Not a valid ZIP file" });
    }
    if (!listResult.out.includes("Content/ROD/") && !listResult.out.includes("Content\\ROD\\")) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({
        error: "ZIP does not contain a Content/ROD/ folder structure -- refusing to extract. Expected paths like Content/ROD/DataAssets/...",
      });
    }

    // Extract into raw-export/, which already has the matching
    // Content/ROD/ structure -- so a ZIP entry like
    // Content/ROD/DataAssets/Town/DT_TownList.json lands at
    // raw-export/Content/ROD/DataAssets/Town/DT_TownList.json,
    // exactly where the pipeline's SRC constant already looks.
    const extractRoot = path.join(PROJECT_ROOT, "raw-export");
    const extractResult = await new Promise((resolve) => {
      const proc = spawn("unzip", ["-o", zipPath, "-d", extractRoot]);
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => { out += d.toString(); });
      proc.stderr.on("data", (d) => { err += d.toString(); });
      proc.on("close", (code) => resolve({ code, out, err }));
    });

    fs.unlinkSync(zipPath);

    if (extractResult.code !== 0) {
      return res.status(500).json({ error: "Extraction failed", details: extractResult.err });
    }

    // The real game export's Content.zip has Localization/ and
    // WwiseAudio/ as siblings of ROD/, not nested inside it -- see
    // mergeMisplacedContentSiblings()'s own doc comment for the full
    // reasoning. Fix that up now, before reporting success, so every
    // upload (not just ones someone remembers to check for this)
    // lands where the pipeline actually looks.
    const movedFolders = mergeMisplacedContentSiblings(extractRoot);

    // Parse unzip's own output for a simple added/updated file list
    // rather than re-walking the filesystem ourselves -- unzip already
    // tells us exactly what it did, line by line.
    const lines = extractResult.out.split("\n").filter((l) => /(inflating|extracting):/i.test(l));
    const files = lines.map((l) => l.split(/:\s+/)[1]).filter(Boolean).map((f) => f.trim());

    res.json({ ok: true, fileCount: files.length, files: files.slice(0, 200), movedFolders });
  } catch (e) {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/pipeline/upload-files
 * Body: { files: [{ relativePath, content }] } -- relativePath is
 * relative to Content/ROD/ (e.g. "DataAssets/Town/DT_TownList.json"),
 * content is the raw JSON text. Used for the "just upload the 1-4
 * files that changed" workflow the user asked for, distinct from a
 * full ZIP -- no folder-structure check needed here since there's no
 * folder, just per-file JSON validation (does it parse at all) before
 * writing it to raw-export/Content/ROD/{relativePath}.
 *
 * relativePath is sanitized to prevent writing outside raw-export/
 * (rejects any path containing ".." segments) -- this is the one
 * piece of path-safety this endpoint enforces, since it accepts a
 * caller-specified relative path rather than deriving one from a
 * fixed ZIP structure the way upload-zip does.
 */
app.post("/api/pipeline/upload-files", async (req, res) => {
  const { files } = req.body || {};
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }

  const results = [];
  for (const file of files) {
    const { relativePath, content } = file;
    if (!relativePath || typeof content !== "string") {
      results.push({ relativePath, ok: false, error: "Missing relativePath or content" });
      continue;
    }
    if (relativePath.split(/[\\/]/).includes("..")) {
      results.push({ relativePath, ok: false, error: "Path traversal rejected" });
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      results.push({ relativePath, ok: false, error: `Not valid JSON: ${e.message}` });
      continue;
    }

    const destPath = path.join(RAW_EXPORT_ROOT, relativePath);
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, JSON.stringify(parsed, null, 2));
      results.push({ relativePath, ok: true });
    } catch (e) {
      results.push({ relativePath, ok: false, error: e.message });
    }
  }

  res.json({ results });
});

/**
 * GET /api/pipeline/download-zip
 * Zips raw-export/Content/ (which already contains the complete
 * Content/ROD/... tree -- this toolkit's raw-export normalizes
 * everything, including Localization and WwiseAudio, under ROD/,
 * unlike the original uploaded archives which sometimes had those as
 * separate top-level siblings; this endpoint reproduces THIS project's
 * own working copy faithfully, not a byte-for-byte reconstruction of
 * whatever the original upload's exact folder layout happened to be)
 * and streams it back as a download. Shells out to the same `zip` CLI
 * already used for nothing else in this file (uploads use `unzip`) --
 * no new npm dependency, consistent with how upload-zip avoids one too.
 */
app.get("/api/pipeline/download-zip", async (req, res) => {
  if (!fs.existsSync(path.join(PROJECT_ROOT, "raw-export", "Content"))) {
    return res.status(404).json({ error: "raw-export/Content/ does not exist -- nothing to download" });
  }

  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const zipPath = path.join(UPLOAD_TMP_DIR, `Content-export-${Date.now()}.zip`);

  const zipResult = await new Promise((resolve) => {
    // -r recursive, -q quiet (no per-file listing needed here, unlike
    // upload-zip's extraction where we parse that listing for the
    // response). cwd is raw-export/ so the archive's own internal
    // paths start at "Content/...", matching the Content.zip naming
    // and layout convention every prior upload in this project used.
    const proc = spawn("zip", ["-r", "-q", zipPath, "Content"], { cwd: path.join(PROJECT_ROOT, "raw-export") });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("close", (code) => resolve({ code, err }));
  });

  if (zipResult.code !== 0 || !fs.existsSync(zipPath)) {
    return res.status(500).json({ error: "Failed to create ZIP", details: zipResult.err });
  }

  res.download(zipPath, "Content.zip", (err) => {
    // res.download streams the file then calls this once done (or on
    // error) -- clean up the temp file either way, regardless of
    // whether the download itself succeeded, so .upload-tmp/ doesn't
    // accumulate every export a user ever downloaded.
    fs.unlink(zipPath, () => {});
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Download failed", details: err.message });
    }
  });
});

/**
 * GET /api/pipeline/download-file?path=DataAssets/Town/DT_TownList.json
 * Streams a single raw JSON file for individual download -- the "just
 * grab the one file I need" counterpart to download-zip, for when a
 * user wants to inspect or hand off one specific raw export file
 * rather than the entire archive. `path` is relative to
 * raw-export/Content/ROD/, the same root upload-files writes into, and
 * is sanitized against ".." path-traversal the same way that endpoint
 * already is.
 */
app.get("/api/pipeline/download-file", (req, res) => {
  const relativePath = req.query.path;
  if (!relativePath || typeof relativePath !== "string") {
    return res.status(400).json({ error: "Missing ?path= query parameter" });
  }
  if (relativePath.split(/[\\/]/).includes("..")) {
    return res.status(400).json({ error: "Path traversal rejected" });
  }

  const fullPath = path.join(RAW_EXPORT_ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).json({ error: `File not found: ${relativePath}` });
  }

  const filename = relativePath.split(/[\\/]/).pop();
  res.download(fullPath, filename);
});

/**
 * GET /api/mapping-files/status
 * Returns the latest locally-available USMAP/IDA file (if any) for
 * each type, without streaming any file content -- this is what the
 * Data Coverage page calls to decide whether its "Direct" button
 * should be enabled or greyed out, and what version number to show.
 * Never touches the existing, manually-set Discord "Download" link
 * (dev-reference.json) at all -- these are two fully independent
 * sources, exactly as intended: Direct for whatever's been placed on
 * the backend, Download for the external link either way.
 *
 * Includes the exact absolute path being scanned (_scanPath) and
 * whether that path exists at all (_scanPathExists) -- if a user has
 * placed files somewhere that LOOKS right but the running server
 * still reports null for everything, the most common real cause is a
 * path/volume-mount mismatch (e.g. a Docker bind-mount that doesn't
 * actually expose the host folder the files were placed in at the
 * path this server sees) rather than a bug in the folder-naming
 * itself -- this field lets that be confirmed or ruled out in one
 * request instead of more back-and-forth guessing.
 */
app.get("/api/mapping-files/status", (req, res) => {
  const result = { _scanPath: MAPPING_FILES_ROOT, _scanPathExists: fs.existsSync(MAPPING_FILES_ROOT) };
  for (const type of MAPPING_FILE_TYPES) {
    const found = findLatestMappingFile(type);
    result[type] = found ? { version: found.version, filename: found.filename } : null;
  }
  res.json(result);
});

/**
 * GET /api/mapping-files/download/:type
 * Streams the actual latest file for the "Direct" button. Re-resolves
 * the latest version on every call (cheap -- a handful of directory
 * listings, not a real scan) rather than trusting a value cached from
 * an earlier /status call, so a file dropped onto the backend between
 * page-load and button-click is picked up correctly.
 */
app.get("/api/mapping-files/download/:type", (req, res) => {
  const type = req.params.type;
  if (!MAPPING_FILE_TYPES.includes(type)) {
    return res.status(400).json({ error: `Unknown mapping file type: ${type}` });
  }
  const found = findLatestMappingFile(type);
  if (!found) {
    return res.status(404).json({ error: `No local ${type} file found under mapping-files/` });
  }
  res.download(found.fullPath, found.filename);
});

// Serve everything in this folder as static files (index.html, app/, Content/).
// No caching surprises during active data updates -- the dataset is small
// enough that this doesn't matter for performance. Deliberately NO
// catch-all fallback route after this: a genuinely missing file (e.g.
// a data JSON that doesn't exist yet because the pipeline hasn't run)
// must 404 for real, not silently receive index.html back with a 200 --
// that mismatch (fetch() expecting JSON, getting an HTML page) was the
// actual cause of a real "Unexpected token '<'... is not valid JSON"
// report on a fresh/emptied instance. A catch-all used to sit here "in
// case the app grows client-side routes later" -- it never did (there
// is no client-side routing at all, confirmed), and it was actively
// harmful once there was real missing-data-file cases to consider.
app.use(
  express.static(__dirname, {
    setHeaders: (res) => {
      res.set("Cache-Control", "no-cache");
    },
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ROD Database Toolkit listening on http://0.0.0.0:${PORT}`);
});
