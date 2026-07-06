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
const archiver = require("archiver");

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
    // Without this, a missing `python3` binary emits an 'error' event
    // with no listener -- Node's default behavior for an unhandled
    // 'error' event is to THROW, crashing the entire server process,
    // not just fail this one request. Confirmed as a real, live crash
    // (a different missing binary, `zip`, but the exact same pattern)
    // from a real deployment's own server logs. Every spawn() call in
    // this file needs this same guard, not just the one that happened
    // to be reported first.
    proc.on("error", (err) => resolve({ code: -1, stdout, stderr: `Failed to start python3: ${err.message}` }));
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
  // Cached by default: the real status check re-runs every section
  // (that's what makes its Schema check honest), which by 44 sections
  // + the Maps/DNG level scans takes minutes -- serving it
  // synchronously on page load produced a real 500/504 from a real
  // deployment. --status-cached returns the last computed report
  // instantly (tagged cached:true + generatedAt); fresh checks run as
  // a background job via /api/pipeline/refresh-status below, which
  // rewrites the cache on completion.
  const fresh = req.query.fresh === "1";
  const result = await runPipeline([fresh ? "--status" : "--status-cached"]);
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
 * POST /api/pipeline/refresh-status
 * Starts a fresh, full status computation (`--status`) as a background
 * job through the same single-job machinery rebuilds use (409 if any
 * job is running). The pipeline saves the fresh report to its status
 * cache on completion, so the dashboard just polls
 * /api/pipeline/rebuild-progress and then re-fetches the (now updated)
 * cached /api/pipeline/status.
 */
app.post("/api/pipeline/refresh-status", (req, res) => {
  if (currentBuildJob && currentBuildJob.running) {
    return res.status(409).json({
      error: "A build is already running",
      jobId: currentBuildJob.id,
      mode: currentBuildJob.mode,
      startedAt: currentBuildJob.startedAt,
    });
  }
  const job = startBuildJob(["--status"], "status-refresh");
  res.json({ ok: true, started: true, jobId: job.id, mode: job.mode, startedAt: job.startedAt });
});

/**
 * POST /api/pipeline/rebuild
 * Body: { onlyKey?: string, fromKey?: string, groupKey?: string } --
 * all optional; with none, runs the full pipeline.
 *
 * NO LONGER runs to completion inside the request. The original
 * implementation did ("a full rebuild only takes a few seconds --
 * confirmed throughout this project's own development"), and that was
 * true when it was written; by 44 sections plus the Maps/DNG level
 * scans, a full run takes minutes and the blocking request produced a
 * real 504 from a real deployment. Rebuilds now start a background
 * job and return immediately; the dashboard polls
 * /api/pipeline/rebuild-progress for the live log and completion.
 * Only ONE job runs at a time -- a second request while one is
 * running gets a 409 with the running job's id, never a silent queue
 * or a second concurrent pipeline racing the first over the same
 * output files.
 */
let currentBuildJob = null; // { id, args, mode, startedAt, log, running, exitCode, finishedAt }

function startBuildJob(args, mode) {
  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    args,
    mode,
    startedAt: new Date().toISOString(),
    log: "",
    running: true,
    exitCode: null,
    finishedAt: null,
  };
  // -u: unbuffered Python stdout, so the polled log is genuinely live
  // rather than arriving in one flush at process exit.
  const proc = spawn("python3", ["-u", PIPELINE_SCRIPT, ...args], { cwd: PROJECT_ROOT });
  const append = (d) => {
    job.log += d.toString();
    // Cap in-memory log: keep the newest chunk. 200k chars is far more
    // than a full run prints; this is belt-and-braces, not a limit
    // anyone should hit.
    if (job.log.length > 200000) job.log = job.log.slice(-150000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  proc.on("close", (code) => {
    job.running = false;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });
  // Same unhandled-'error'-event crash guard every spawn() in this
  // file carries (see runPipeline above for the confirmed incident).
  proc.on("error", (err) => {
    job.running = false;
    job.exitCode = -1;
    job.finishedAt = new Date().toISOString();
    job.log += `Failed to start python3: ${err.message}\n`;
  });
  currentBuildJob = job;
  return job;
}

app.post("/api/pipeline/rebuild", async (req, res) => {
  if (currentBuildJob && currentBuildJob.running) {
    return res.status(409).json({
      error: "A build is already running",
      jobId: currentBuildJob.id,
      mode: currentBuildJob.mode,
      startedAt: currentBuildJob.startedAt,
    });
  }
  const { onlyKey, fromKey, groupKey } = req.body || {};
  const args = [];
  let mode = "full";
  if (groupKey) { args.push(`--group=${groupKey}`); mode = `group:${groupKey}`; }
  else if (onlyKey) { args.push(`--only=${onlyKey}`); mode = `only:${onlyKey}`; }
  else if (fromKey) { args.push(`--from=${fromKey}`); mode = `from:${fromKey}`; }

  const job = startBuildJob(args, mode);
  res.json({ ok: true, started: true, jobId: job.id, mode: job.mode, startedAt: job.startedAt });
});

/**
 * GET /api/pipeline/rebuild-progress
 * Snapshot of the current (or most recently finished) build job:
 * { running, jobId, mode, startedAt, finishedAt, exitCode, log }.
 * The log is the full captured stdout+stderr (capped, newest kept) --
 * the dashboard tails it live while running and shows the final
 * output on completion, exactly what the old synchronous response
 * used to contain, just poll-shaped.
 */
app.get("/api/pipeline/rebuild-progress", (req, res) => {
  if (!currentBuildJob) {
    return res.json({ running: false, jobId: null });
  }
  const j = currentBuildJob;
  res.json({
    running: j.running,
    jobId: j.id,
    mode: j.mode,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    exitCode: j.exitCode,
    log: j.log,
  });
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
      proc.on("error", (err) => resolve({ code: -1, out: "", spawnError: err.message }));
    });

    if (listResult.spawnError) {
      fs.unlinkSync(zipPath);
      return res.status(500).json({ error: `Server is missing the "unzip" command: ${listResult.spawnError}` });
    }

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
      proc.on("error", (e) => resolve({ code: -1, out: "", err: e.message, spawnError: true }));
    });

    fs.unlinkSync(zipPath);

    if (extractResult.spawnError) {
      return res.status(500).json({ error: `Server is missing the "unzip" command: ${extractResult.err}` });
    }

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
    let files = lines.map((l) => l.split(/:\s+/)[1]).filter(Boolean).map((f) => f.trim());

    // unzip's own log reflects where files were extracted to BEFORE
    // the merge above ran -- e.g. ".../raw-export/Content/Localization/
    // Game/de/Game.json", the misplaced pre-merge location, even
    // though the actual file has since been moved to
    // ".../Content/ROD/Localization/Game/de/Game.json". Reporting the
    // stale path here was a real, confirmed bug: the frontend's
    // "Unrecognized Files" check matches each reported path against
    // every section's known rawInputs patterns, which are relative to
    // Content/ROD/ -- a stale Content/Localization/... path (missing
    // the /ROD/ segment) could never match, so every Localization file
    // showed up as unrecognized on every single upload, despite having
    // already been correctly repositioned by the merge two lines above.
    // Rewritten here to match reality for every folder the merge
    // actually touched, not just Localization/WwiseAudio by name --
    // if mergeMisplacedContentSiblings() is ever extended to handle
    // another misplaced sibling later, this stays correct automatically.
    for (const name of movedFolders) {
      const stalePrefix = `${path.sep}Content${path.sep}${name}${path.sep}`;
      const correctedPrefix = `${path.sep}Content${path.sep}ROD${path.sep}${name}${path.sep}`;
      files = files.map((f) => f.includes(stalePrefix) ? f.replace(stalePrefix, correctedPrefix) : f);
    }

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
 * and streams it back as a download.
 *
 * Uses the `archiver` npm package, NOT the `zip` CLI binary. This
 * used to shell out to `zip -r` -- deliberately avoiding a new npm
 * dependency, the same reasoning `unzip` still uses for uploads. That
 * reasoning turned out to be wrong for THIS specific case: `zip`
 * isn't guaranteed to be present in every deployment's container
 * image (confirmed by a real crash report -- `Error: spawn zip
 * ENOENT` -- from an actual Docker deployment missing it). Worse,
 * the original code had no 'error' listener on the spawned process,
 * so a missing binary didn't just fail this one request -- Node's
 * default behavior for an unhandled 'error' event on an EventEmitter
 * is to THROW, which crashed the entire server process for every
 * user, not just whoever clicked download. `archiver` is pure JS with
 * no external binary dependency at all, so this failure mode can't
 * happen anymore for this endpoint, in any environment. It also
 * streams straight into the HTTP response instead of writing a full
 * temp file to disk first, which is both simpler and more memory-
 * appropriate for an archive that can run several hundred MB.
 */
app.get("/api/pipeline/download-zip", async (req, res) => {
  const contentRoot = path.join(PROJECT_ROOT, "raw-export", "Content");
  if (!fs.existsSync(contentRoot)) {
    return res.status(404).json({ error: "raw-export/Content/ does not exist -- nothing to download" });
  }

  res.attachment("Content.zip");
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 6 } }); // moderate compression -- balances speed against size for an archive this large
  archive.on("error", (err) => {
    // If streaming has already started, headers are sent and we can't
    // switch to a JSON error response anymore -- just end the
    // response. The client sees a truncated download rather than a
    // clean error in that case, but critically the SERVER doesn't go
    // down over it, which is the actual bug this replaces.
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create ZIP", details: err.message });
    } else {
      res.end();
    }
  });

  archive.pipe(res);
  archive.directory(contentRoot, "Content");
  archive.finalize();
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

// ----------------------------------------------------------------------
// DataTable/DataAsset -> CSV export
//
// Converts a raw exported JSON file into a CSV matching Unreal
// Engine's OWN DataTable CSV import/export convention, so the result
// can be re-imported into the editor for testing, rebuilding a
// reference table, or manual editing -- exactly the workflow
// requested. UE encodes nested struct fields as "(Key=Value,...)" and
// arrays as "(Item1,Item2,...)" inside a CSV cell (quoted whenever the
// cell contains a comma) -- reimplemented here from that documented
// convention, not guessed, and verified against this export's own
// nested-struct and nested-array DataTable rows before shipping.
//
// DataTables (the real target of this feature) get a proper Name +
// one-column-per-field CSV. DataAssets (which have no native "rows"
// at all -- a single Properties object per Default__ object) get a
// best-effort SINGLE-ROW export instead: same struct/array encoding,
// but stated as best-effort in the JSON response's `kind` field
// (surfaced in the UI) since UE has no equivalent "import a DataAsset
// from CSV" workflow this could target -- it's offered anyway, per
// the request, since "it wouldn't hurt to have this too".
// ----------------------------------------------------------------------

function ueCsvStringifyValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return `(${value.map((v) => ueCsvStringifyValue(v)).join(",")})`;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value).map(([k, v]) => `${k}=${ueCsvStringifyValue(v)}`);
    return `(${parts.join(",")})`;
  }
  return String(value);
}

function csvEscapeCell(raw) {
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function rowsToCsv(rows, nameColumn) {
  // Column order: nameColumn first, then every field seen across all
  // rows in first-seen order (UE requires one consistent header row;
  // a row missing a field some other row has gets an empty cell, not
  // a dropped column).
  const columns = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
    }
  }
  const lines = [[nameColumn, ...columns].map(csvEscapeCell).join(",")];
  for (const row of rows) {
    const cells = [row.name, ...columns.map((c) => ueCsvStringifyValue(row.fields[c]))];
    lines.push(cells.map(csvEscapeCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * GET /api/pipeline/export-csv?path=DataAssets/WorldAdmin/DT_ItemLotTable.json
 * `path` is relative to raw-export/Content/ROD/, same traversal guard
 * as download-file. Detects DataTable vs. generic-object-list shape
 * from the file's own structure rather than trusting the filename.
 */
app.get("/api/pipeline/export-csv", (req, res) => {
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

  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  } catch (e) {
    return res.status(400).json({ error: `Not valid JSON: ${e.message}` });
  }
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: "Expected an UnrealPak-JSON export array (a single top-level object per asset) -- this file's shape isn't recognized." });
  }

  const outName = relativePath.split(/[\\/]/).pop().replace(/\.json$/i, ".csv");
  const first = data[0];

  // DataTable shape: exactly one top-level object carrying a "Rows" map.
  if (data.length === 1 && first && typeof first.Rows === "object" && first.Rows !== null) {
    const rows = Object.entries(first.Rows).map(([rowName, fields]) => ({ name: rowName, fields: fields || {} }));
    const csv = rowsToCsv(rows, "Name");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.setHeader("X-Export-Kind", "datatable");
    return res.send(csv);
  }

  // Best-effort DataAsset export: one row per top-level object, using
  // its own Name and Properties -- explicitly labeled best-effort via
  // the X-Export-Kind header (the frontend surfaces this before
  // download) since this isn't a real UE import convention.
  const rows = data
    .filter((obj) => obj && typeof obj === "object")
    .map((obj, i) => ({ name: obj.Name || `Row${i}`, fields: obj.Properties || {} }));
  if (!rows.length) {
    return res.status(400).json({ error: "No exportable rows found in this file (no Rows map and no Properties objects)." });
  }
  const csv = rowsToCsv(rows, "Name");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("X-Export-Kind", "dataasset-best-effort");
  res.send(csv);
});

/**
 * GET /api/pipeline/export-csv-info?path=...
 * A cheap pre-check the frontend calls before offering the download
 * button, so it can show "DataTable, 242 rows" or "DataAsset,
 * best-effort" without downloading the whole CSV just to find out.
 */
app.get("/api/pipeline/export-csv-info", (req, res) => {
  const relativePath = req.query.path;
  if (!relativePath || typeof relativePath !== "string" || relativePath.split(/[\\/]/).includes("..")) {
    return res.status(400).json({ error: "Missing or invalid ?path=" });
  }
  const fullPath = path.join(RAW_EXPORT_ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).json({ error: `File not found: ${relativePath}` });
  }
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0].Rows === "object" && data[0].Rows !== null) {
      return res.json({ kind: "datatable", rowCount: Object.keys(data[0].Rows).length });
    }
    if (Array.isArray(data)) {
      const rows = data.filter((o) => o && typeof o === "object" && o.Properties);
      return res.json({ kind: "dataasset-best-effort", rowCount: rows.length });
    }
    return res.json({ kind: "unrecognized", rowCount: 0 });
  } catch (e) {
    return res.status(400).json({ error: `Not valid JSON: ${e.message}` });
  }
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

// ----------------------------------------------------------------------
// Modding Guides API
//
// USER content, not derived game data -- guides live OUTSIDE the
// pipeline on purpose (no pipeline section builds or overwrites them):
//   guides/            *.md files, one per guide
//   guides/manifest.json   configurable limits (see DEFAULT_GUIDE_CONFIG)
//   uploads/<guideId>/     images pasted/dropped into that guide
// Both folders sit under the statically-served project root, so a
// guide's MD references its images with plain relative URLs
// (uploads/<guideId>/<file>) and the browser just fetches them.
// ----------------------------------------------------------------------
const GUIDES_DIR = path.join(PROJECT_ROOT, "guides");
const GUIDE_UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");

// Every limit is a plain number in guides/manifest.json, editable by
// hand to any value -- these are only the defaults written when no
// manifest exists yet. allowEditing=false turns the whole section
// read-only (no create/edit/delete/image-upload; browsing still works).
const DEFAULT_GUIDE_CONFIG = {
  maxGuides: 20,
  maxImagesPerGuide: 20,
  maxImageSizeMB: 25,
  maxGuideFileSizeMB: 10,
  allowEditing: true,
};

function loadGuideConfig() {
  const manifestPath = path.join(GUIDES_DIR, "manifest.json");
  try {
    if (!fs.existsSync(GUIDES_DIR)) fs.mkdirSync(GUIDES_DIR, { recursive: true });
    if (!fs.existsSync(GUIDE_UPLOADS_DIR)) fs.mkdirSync(GUIDE_UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(manifestPath, JSON.stringify(DEFAULT_GUIDE_CONFIG, null, 2));
      return { ...DEFAULT_GUIDE_CONFIG };
    }
    // Merge over defaults so a hand-edited manifest missing a key
    // still behaves sanely instead of turning a limit into undefined.
    return { ...DEFAULT_GUIDE_CONFIG, ...JSON.parse(fs.readFileSync(manifestPath, "utf-8")) };
  } catch (e) {
    return { ...DEFAULT_GUIDE_CONFIG };
  }
}

// Filesystem errors in the guide endpoints (EACCES from a real Docker
// deployment where /home/node/app was root-owned while node ran
// unprivileged) used to escape as unhandled throws -- raw stack traces
// in the log and bare 500s to the client. Every write path now runs
// through this instead: a clean JSON error naming the actual fix
// (run the "Modding Guides Init" focus build where the filesystem is
// writable, or chown/mount guides/ + uploads/ for the node user).
function guideFsErrorResponse(res, e) {
  if (e && (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS")) {
    return res.status(500).json({
      error: `The server user cannot write to the guides storage (${e.code}). ` +
        `In Docker: chown the app directory (or mount guides/ and uploads/ as writable volumes) ` +
        `for the user node runs as, or run the "Modding Guides Init" focus build ` +
        `(Build Dashboard, or: python3 tools/build_pipeline.py --group=guides) in a context that can write.`,
      code: e.code,
    });
  }
  return res.status(500).json({ error: `Guide storage error: ${e.message}`, code: e.code || null });
}

// Guide ids are slugs derived from the title at creation and STABLE
// afterwards (renaming the title inside the MD doesn't move the file).
// Strict allowlist everywhere an id arrives from the client -- the id
// becomes a filesystem path component in two places.
function sanitizeGuideId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,80}$/.test(id) ? id : null;
}

function slugifyTitle(title) {
  const base = String(title || "untitled").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
  let slug = base, n = 2;
  while (fs.existsSync(path.join(GUIDES_DIR, `${slug}.md`))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

function guideTitleFromContent(content, fallback) {
  const m = /^#\s+(.+)$/m.exec(content || "");
  return (m ? m[1].trim() : "") || fallback;
}

function listGuides() {
  if (!fs.existsSync(GUIDES_DIR)) return [];
  return fs.readdirSync(GUIDES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const id = f.slice(0, -3);
      const full = path.join(GUIDES_DIR, f);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, "utf-8");
      const imgDir = path.join(GUIDE_UPLOADS_DIR, id);
      const imageCount = fs.existsSync(imgDir)
        ? fs.readdirSync(imgDir).filter((x) => !x.startsWith(".")).length
        : 0;
      return {
        id,
        title: guideTitleFromContent(content, id),
        updatedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        imageCount,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

app.get("/api/guides", (req, res) => {
  const config = loadGuideConfig();
  res.json({ config, guides: listGuides() });
});

app.get("/api/guides/:id", (req, res) => {
  const id = sanitizeGuideId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid guide id" });
  const full = path.join(GUIDES_DIR, `${id}.md`);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Guide not found" });
  const content = fs.readFileSync(full, "utf-8");
  res.json({ id, title: guideTitleFromContent(content, id), content });
});

app.post("/api/guides", (req, res) => {
  const config = loadGuideConfig();
  if (!config.allowEditing) return res.status(403).json({ error: "Editing is disabled in guides/manifest.json (allowEditing: false)" });
  const existing = listGuides();
  if (existing.length >= config.maxGuides) {
    return res.status(409).json({ error: `Guide limit reached (${config.maxGuides} — configurable in guides/manifest.json)` });
  }
  const { title, content } = req.body || {};
  const text = typeof content === "string" ? content : `# ${title || "Untitled Guide"}\n\n`;
  if (Buffer.byteLength(text, "utf-8") > config.maxGuideFileSizeMB * 1024 * 1024) {
    return res.status(413).json({ error: `Guide exceeds ${config.maxGuideFileSizeMB} MB (configurable in guides/manifest.json)` });
  }
  try {
    loadGuideConfig(); // ensures folders exist
    const id = slugifyTitle(title || guideTitleFromContent(text, "untitled"));
    fs.writeFileSync(path.join(GUIDES_DIR, `${id}.md`), text);
    res.json({ ok: true, id, title: guideTitleFromContent(text, id) });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});

app.put("/api/guides/:id", (req, res) => {
  const config = loadGuideConfig();
  if (!config.allowEditing) return res.status(403).json({ error: "Editing is disabled in guides/manifest.json (allowEditing: false)" });
  const id = sanitizeGuideId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid guide id" });
  const full = path.join(GUIDES_DIR, `${id}.md`);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Guide not found" });
  const { content } = req.body || {};
  if (typeof content !== "string") return res.status(400).json({ error: "Missing content" });
  if (Buffer.byteLength(content, "utf-8") > config.maxGuideFileSizeMB * 1024 * 1024) {
    return res.status(413).json({ error: `Guide exceeds ${config.maxGuideFileSizeMB} MB (configurable in guides/manifest.json)` });
  }
  try {
    fs.writeFileSync(full, content);
    res.json({ ok: true, id, title: guideTitleFromContent(content, id) });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});

app.delete("/api/guides/:id", (req, res) => {
  const config = loadGuideConfig();
  if (!config.allowEditing) return res.status(403).json({ error: "Editing is disabled in guides/manifest.json (allowEditing: false)" });
  const id = sanitizeGuideId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid guide id" });
  const full = path.join(GUIDES_DIR, `${id}.md`);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Guide not found" });
  try {
    fs.unlinkSync(full);
    const imgDir = path.join(GUIDE_UPLOADS_DIR, id);
    if (fs.existsSync(imgDir)) fs.rmSync(imgDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});

/**
 * POST /api/guides/:id/images
 * Body: { filename, dataBase64 } -- the editor sends pasted/dropped
 * images here, then inserts the returned relative URL at the cursor.
 * Extension is derived from the client filename but allowlisted;
 * stored names are server-generated (img_<timestamp>.<ext>), never the
 * client's name, so the only client-controlled path piece is the
 * already-sanitized guide id.
 */
app.post("/api/guides/:id/images", (req, res) => {
  const config = loadGuideConfig();
  if (!config.allowEditing) return res.status(403).json({ error: "Editing is disabled in guides/manifest.json (allowEditing: false)" });
  const id = sanitizeGuideId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid guide id" });
  if (!fs.existsSync(path.join(GUIDES_DIR, `${id}.md`))) return res.status(404).json({ error: "Guide not found" });

  const { filename, dataBase64 } = req.body || {};
  if (typeof dataBase64 !== "string" || !dataBase64) return res.status(400).json({ error: "Missing image data" });
  const ext = String(filename || "").toLowerCase().match(/\.(png|jpg|jpeg|gif|webp)$/);
  const safeExt = ext ? ext[1] : "png";

  const buf = Buffer.from(dataBase64, "base64");
  if (buf.length > config.maxImageSizeMB * 1024 * 1024) {
    return res.status(413).json({ error: `Image exceeds ${config.maxImageSizeMB} MB (configurable in guides/manifest.json)` });
  }
  try {
    const imgDir = path.join(GUIDE_UPLOADS_DIR, id);
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    const existing = fs.readdirSync(imgDir).filter((x) => !x.startsWith(".")).length;
    if (existing >= config.maxImagesPerGuide) {
      return res.status(409).json({ error: `Image limit reached for this guide (${config.maxImagesPerGuide} — configurable in guides/manifest.json)` });
    }
    const name = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${safeExt}`;
    fs.writeFileSync(path.join(imgDir, name), buf);
    res.json({ ok: true, url: `uploads/${id}/${name}`, imageCount: existing + 1 });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});

// ----------------------------------------------------------------------
// Manual Map Markers API
//
// USER content, like Guides: manually-placed pins on the World Map's
// Field Map / Towns / Dungeons / World View surfaces, for exactly the
// places this toolkit has NO exported coordinate data (Towns and
// Dungeons entirely; extra hand-placed detail on Field Map areas).
// Lives outside the pipeline on purpose -- map-markers/ sits at the
// project root next to guides/, never touched by build_pipeline.py.
//
// One manifest file per map surface: map-markers/<mapType>__<areaKey>.json,
// a plain array of {id, iconKey, x, y, label, createdAt}. x/y are
// NORMALIZED 0.0-1.0 scalers against that surface's own image/canvas --
// deliberately not world coordinates, so the same entry shape works
// for Field Map areas (which have world coords) and Towns/Dungeons
// (which never will) alike. Capped at 999 entries per manifest, per
// the requested limit.
// ----------------------------------------------------------------------
const MAP_MARKERS_DIR = path.join(PROJECT_ROOT, "map-markers");
const MAP_MARKERS_MAX_PER_AREA = 999;
const MAP_MARKER_TYPES = ["field", "world", "town", "dungeon"];

function sanitizeMarkerAreaKey(key) {
  return typeof key === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(key) ? key : null;
}

function markerManifestPath(mapType, areaKey) {
  if (!MAP_MARKER_TYPES.includes(mapType)) return null;
  const safeKey = sanitizeMarkerAreaKey(areaKey);
  if (!safeKey) return null;
  return path.join(MAP_MARKERS_DIR, `${mapType}__${safeKey}.json`);
}

function loadMarkerManifest(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

app.get("/api/map-markers/:mapType/:areaKey", (req, res) => {
  const filePath = markerManifestPath(req.params.mapType, req.params.areaKey);
  if (!filePath) return res.status(400).json({ error: "Invalid map type or area key" });
  const entries = loadMarkerManifest(filePath);
  res.json({ entries, count: entries.length, max: MAP_MARKERS_MAX_PER_AREA });
});

app.post("/api/map-markers/:mapType/:areaKey", (req, res) => {
  const filePath = markerManifestPath(req.params.mapType, req.params.areaKey);
  if (!filePath) return res.status(400).json({ error: "Invalid map type or area key" });

  const { iconKey, x, y, label } = req.body || {};
  if (typeof iconKey !== "string" || !iconKey.trim()) {
    return res.status(400).json({ error: "Missing iconKey" });
  }
  const nx = Number(x), ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || nx > 1 || ny < 0 || ny > 1) {
    return res.status(400).json({ error: "x and y must be numbers between 0 and 1 (normalized position on the map surface)" });
  }

  try {
    if (!fs.existsSync(MAP_MARKERS_DIR)) fs.mkdirSync(MAP_MARKERS_DIR, { recursive: true });
    const entries = loadMarkerManifest(filePath);
    if (entries.length >= MAP_MARKERS_MAX_PER_AREA) {
      return res.status(409).json({ error: `Marker limit reached for this map (${MAP_MARKERS_MAX_PER_AREA})` });
    }
    const entry = {
      id: `mk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      iconKey: iconKey.trim(),
      x: nx,
      y: ny,
      label: typeof label === "string" ? label.slice(0, 200) : "",
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    res.json({ ok: true, entry, count: entries.length, max: MAP_MARKERS_MAX_PER_AREA });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});

app.delete("/api/map-markers/:mapType/:areaKey/:entryId", (req, res) => {
  const filePath = markerManifestPath(req.params.mapType, req.params.areaKey);
  if (!filePath) return res.status(400).json({ error: "Invalid map type or area key" });
  try {
    const entries = loadMarkerManifest(filePath);
    const filtered = entries.filter((e) => e.id !== req.params.entryId);
    if (filtered.length === entries.length) return res.status(404).json({ error: "Marker not found" });
    fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2));
    res.json({ ok: true, count: filtered.length, max: MAP_MARKERS_MAX_PER_AREA });
  } catch (e) {
    guideFsErrorResponse(res, e);
  }
});


// Read-only REST API layer (isolated file, see api/routes.js) --
// deleting api/routes.js removes only this line's effect; nothing
// else in this file depends on it.
app.use("/api", require("./api/routes")(PROJECT_ROOT));

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
