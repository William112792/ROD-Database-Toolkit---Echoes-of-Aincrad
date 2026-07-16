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
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const archiver = require("archiver");

const app = express();
const SERVER_STARTED_AT = new Date().toISOString();
const PORT = process.env.PORT || 8000;
const PROJECT_ROOT = __dirname;
// Bumped every toolkit update -- surfaced by /api/server-info and the
// RODSchema view so "which server.js is actually RUNNING" is one look,
// not a guessing game. (A Docker/Dockge container restart does NOT
// pick up copied files unless the project is bind-mounted; an image
// built with COPY needs a rebuild -- the exact trap behind the
// "latest server.js, restarted, still Cannot POST" report.)
const SERVER_BUILD = "2026-07-11.5";
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
app.use("/api/pipeline/upload-sdk-zip", express.raw({ type: "application/zip", limit: "500mb" }));
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

  // WwiseAudio DELIBERATELY REMOVED from this list.
  //
  // This function was written when the pipeline expected the Wwise tree at
  // Content/ROD/WwiseAudio, so it moved it there. That expectation was
  // WRONG: in the real game, Content/ contains ROD, WwiseAudio and
  // Localization as SIBLINGS (Content itself sits under EchoesofAincrad,
  // the /Game equivalent), and the wwise_audio section now correctly reads
  // Content/WwiseAudio. Leaving the mover in place meant a dashboard
  // upload filed 50,000 .wem files exactly where the pipeline no longer
  // looks -- so every event reported "not in this export" while the audio
  // sat on disk the whole time. A hand-extracted copy worked, which is
  // precisely why this survived: my test path and the user's path differed.
  //
  // Localization DOES belong under ROD (the pipeline's SRC is Content/ROD
  // and it reads SRC/Localization/Game/...), so that one still moves.
  for (const name of ["Localization"]) {
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
  // Self-heal: if an EARLIER upload (with the old buggy list) buried the
  // Wwise tree inside ROD/, move it back out. Without this, anyone who
  // already uploaded would stay broken forever and have to know to delete
  // the folder by hand.
  const buriedWwise = path.join(rodRoot, "WwiseAudio");
  const correctWwise = path.join(contentRoot, "WwiseAudio");
  if (fs.existsSync(buriedWwise) && fs.statSync(buriedWwise).isDirectory()) {
    fs.mkdirSync(correctWwise, { recursive: true });
    const cp = require("child_process").spawnSync("cp", ["-r", `${buriedWwise}/.`, correctWwise]);
    if (cp.status === 0) {
      fs.rmSync(buriedWwise, { recursive: true, force: true });
      moved.push("WwiseAudio (moved OUT of ROD/ -- it belongs beside it)");
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
  // Structured per-section progress, written by build_pipeline.py's
  // _ProgressWriter on every real run (full/--only/--group/--from,
  // terminal-launched runs included). Merged here so the dashboard's
  // per-section indicator (a) updates live while a job runs, (b)
  // survives a page reload mid-run, and (c) still shows the LAST
  // run's states after a server restart, when the in-memory job
  // object is gone.
  let sectionProgress = null;
  try {
    const raw = fs.readFileSync(path.join(PROJECT_ROOT, ".pipeline-progress.json"), "utf-8");
    sectionProgress = JSON.parse(raw);
  } catch (e) {
    sectionProgress = null; // no run recorded yet, or mid-write race -- next poll gets it
  }
  if (!currentBuildJob) {
    // A progress file claiming "running" with no in-memory job is one of
    // TWO very different things, and conflating them was a real bug: it
    // could be a genuine terminal-launched run, OR a run that was killed
    // before finish() (server stopped mid-build). Reporting the second
    // as "running" left the dashboard stuck showing "Build in progress…"
    // with every build button disabled -- and the only thing that would
    // have cleared the file was starting a build, which was disabled.
    //
    // The progress file now carries the build process's pid, so we can
    // just ASK the OS which case this is instead of guessing.
    const claimsRunning = Boolean(sectionProgress && sectionProgress.running);
    let alive = false;
    if (claimsRunning && sectionProgress.pid) {
      try {
        process.kill(sectionProgress.pid, 0); // signal 0 = liveness probe, doesn't kill
        alive = true;
      } catch (e) {
        alive = false; // ESRCH: no such process -- the run is gone
      }
    }
    // Older progress files predate the pid field. Rather than declare
    // them stale (and risk stomping a genuine terminal run) or trust
    // them forever (the bug), treat them as live only briefly: a real
    // run writes a transition every few seconds.
    const stalenessMs = Date.now() - new Date(sectionProgress?.finishedAt || sectionProgress?.startedAt || 0).getTime();
    const unknownButFresh = claimsRunning && !sectionProgress.pid && stalenessMs < 10 * 60 * 1000;
    const genuinelyRunning = claimsRunning && (alive || unknownButFresh);

    return res.json({
      running: genuinelyRunning,
      jobId: null,
      externalRun: genuinelyRunning,
      // An interrupted run: the dashboard says so plainly, offers to
      // clear it, and -- crucially -- leaves the build buttons enabled.
      interrupted: claimsRunning && !genuinelyRunning,
      interruptedInfo: (claimsRunning && !genuinelyRunning) ? {
        mode: sectionProgress.mode,
        startedAt: sectionProgress.startedAt,
        pid: sectionProgress.pid || null,
        completed: (sectionProgress.sections || []).filter((x) => x.state === "ok").length,
        total: (sectionProgress.sections || []).length,
        stoppedAt: (sectionProgress.sections || []).find((x) => x.state === "running") || null,
      } : null,
      sectionProgress,
    });
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
    sectionProgress,
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
/**
 * GET /api/materials/recreation-zip?family=<rootName>
 * Runs tools/generate_ue_material_script.py for the requested family
 * and streams a ZIP: the emitted UE editor script, INSTRUCTIONS.md
 * (how to load it into UE 5.3.2), and referenced-assets.txt (every
 * texture the family's parameters point at, as raw-export-relative
 * paths, so the person can grab them via the Asset Inspector / the
 * per-file download endpoint before running the script).
 *
 * The family name is validated against the Materials index itself --
 * only a rootName that actually exists is accepted, which doubles as
 * input sanitization (no shell, spawn with an argument array).
 */
app.get("/api/materials/recreation-zip", (req, res) => {
  const family = req.query.family;
  if (!family || typeof family !== "string" || !/^[A-Za-z0-9_]+$/.test(family)) {
    return res.status(400).json({ error: "Missing or invalid ?family= (material root name)" });
  }
  const materialsPath = path.join(PROJECT_ROOT, "Content", "ROD", "DataAssets", "Database", "Materials", "Materials.json");
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(materialsPath, "utf-8"));
  } catch (e) {
    return res.status(409).json({ error: "Materials index not built yet -- run the Materials Index section first" });
  }
  const members = entries.filter((m) => m.rootName === family);
  if (!members.length) {
    return res.status(404).json({ error: `No material family rooted at '${family}' in the index` });
  }

  const outScript = path.join(UPLOAD_TMP_DIR, `recreate_${family}.py`);
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const gen = spawn("python3", [
    path.join(PROJECT_ROOT, "tools", "generate_ue_material_script.py"),
    "--family", family, "--out", outScript,
  ], { cwd: path.join(PROJECT_ROOT, "tools") });
  let genErr = "";
  gen.stderr.on("data", (d) => { genErr += d; });
  gen.on("close", (code) => {
    if (code !== 0 || !fs.existsSync(outScript)) {
      return res.status(500).json({ error: `Generator failed (exit ${code}): ${genErr.slice(0, 800)}` });
    }
    // Referenced textures across the whole family (effective params so
    // ancestor-set textures are included too).
    const texPaths = new Set();
    for (const m of members) {
      for (const p of m.effectiveParams || []) {
        if (p.group === "textureParams" && typeof p.value === "string" && p.value.startsWith("/Game/ROD/")) {
          texPaths.add(p.value.slice("/Game/ROD/".length).split(".")[0]);
        }
      }
    }
    const masters = members.filter((m) => m.type === "Material").length;
    const cel = members.filter((m) => m.customShadingModel).length;
    const instructions = [
      `# Recreating the ${family} material family in Unreal Engine 5.3.2`,
      "",
      `This ZIP was generated by the ROD Database Toolkit from the game's real export:`,
      `${members.length} assets (${masters} master, ${members.length - masters} instances, created parents-before-children).`,
      "",
      "## Steps",
      "1. Open your UE 5.3.2 project and enable **Edit > Plugins > Python Editor Script Plugin** (restart if prompted).",
      "2. Import the game's textures FIRST (list in referenced-assets.txt; download each via the toolkit's",
      "   Asset Inspector or /api/pipeline/download-file). Keep the same folder structure under /Game/ROD",
      "   (or pass a different --texture-root when regenerating the script). Missing textures are logged",
      "   and their parameters left unset -- the script still completes.",
      `3. Run the script: **Tools > Execute Python Script** and pick recreate_${family}.py`,
      "   (or in the Output Log's Python bar: `py \"C:/path/to/recreate_" + family + ".py\"`).",
      `4. Assets are created under **/Game/ROD_Recreated/** mirroring the export's folder layout.`,
      "",
      "## What is NOT recreated (and why)",
      "- The master's internal node graph: the game's cooked export contains no MaterialExpression data",
      "  (verified, not assumed). The script scaffolds every parameter the family uses as named nodes and",
      "  wires a minimal BaseColor preview; the cel-shading math itself must be rebuilt by hand on top.",
      cel ? `- ${cel} of these materials use MSM_CelSf, a custom engine shading model stock UE 5.3.2 doesn't` : null,
      cel ? "  have. DEFAULT_LIT is substituted and a warning logged per material." : null,
      "",
      "Regenerate anytime: python3 tools/generate_ue_material_script.py --family " + family,
    ].filter((l) => l !== null).join("\n");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="recreate_${family}.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.destroy(err));
    archive.pipe(res);
    archive.file(outScript, { name: `recreate_${family}.py` });
    archive.append(instructions + "\n", { name: "INSTRUCTIONS.md" });
    archive.append(
      [...texPaths].sort().map((t) => t + "  (raw-export: " + t.replace(/^/, "") + ".json + texture files alongside)").join("\n") + "\n",
      { name: "referenced-assets.txt" });
    archive.finalize();
  });
});

// ===================== Modding: RODSchema + Lua =====================
const RODSCHEMA_ROOT = path.join(PROJECT_ROOT, "rodschema");
const SIGNATURES_PATH = path.join(RODSCHEMA_ROOT, "signatures.json");

/** GET/POST the managed memory-signature list (rodschema/signatures.json). */
app.get("/api/server-info", (req, res) => {
  res.json({
    serverBuild: SERVER_BUILD,
    startedAt: SERVER_STARTED_AT,
    endpoints: {
      rodschemaSignaturesPost: true,
      rodschemaValidatePatch: true,
      rodschemaPackage: true,
      rodschemaPatchExamples: true,
      luamodsPackage: true,
      materialsRecreationZip: true,
    },
  });
});

app.get("/api/rodschema/signatures", (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(SIGNATURES_PATH, "utf-8")));
  } catch (e) {
    res.status(404).json({ error: "rodschema/signatures.json not found -- is the rodschema/ folder deployed?" });
  }
});
app.post("/api/rodschema/signatures", (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.signatures)) {
    return res.status(400).json({ error: "Body must be { signatures: [...] }" });
  }
  for (const s of body.signatures) {
    if (!s.target || typeof s.target !== "string" || !/^[\w:~_]+$/.test(s.target)) {
      return res.status(400).json({ error: `Invalid target name: ${JSON.stringify(s.target)}` });
    }
    if (typeof s.pattern !== "string" || !/^[0-9A-Fa-f? ]*$/.test(s.pattern)) {
      return res.status(400).json({ error: `Pattern for ${s.target} must be hex bytes and ?? wildcards (or empty for a placeholder)` });
    }
    if (s.kind && !["direct", "call-resolve"].includes(s.kind)) {
      return res.status(400).json({ error: `kind for ${s.target} must be 'direct' or 'call-resolve'` });
    }
  }
  const existing = (() => { try { return JSON.parse(fs.readFileSync(SIGNATURES_PATH, "utf-8")); } catch (e) { return { _readme: "" }; } })();
  existing.signatures = body.signatures;
  fs.writeFileSync(SIGNATURES_PATH, JSON.stringify(existing, null, 1));
  res.json({ ok: true, count: body.signatures.length });
});

/**
 * POST /api/rodschema/validate-patch
 * Body: the unified single-JSON patch format:
 *   { "name": "MyMod", "edits": [
 *       { "target": "DataTable", "table": "DT_FixTBoxTable",
 *         "op": "edit"|"add"|"delete", "row": "TB_x", "fields": {...} },
 *       { "target": "DataAsset", "asset": "DataAssets/Items/ItemDataAsset.json",
 *         "property": "WeaponOSItemDataAsMap", "note": "..." } ] }
 * Validates every edit against the REAL raw export (table file found?
 * row exists for edit/delete, doesn't for add? field names present on
 * an existing row?) and returns the per-edit report plus the split
 * RODSchema mod files (PalSchema-style raw layout) -- the same split
 * the package endpoint ships.
 */
app.post("/api/rodschema/validate-patch", (req, res) => {
  const patch = req.body || {};
  if (!patch.name || !/^[\w-]+$/.test(patch.name) || !Array.isArray(patch.edits)) {
    return res.status(400).json({ error: "Patch must be { name: 'ModName', edits: [...] }" });
  }
  const findTable = (tableName) => {
    if (!/^[\w-]+$/.test(tableName)) return null;
    const hits = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name === `${tableName}.json`) hits.push(p);
      }
    };
    try { walk(path.join(RAW_EXPORT_ROOT, "DataAssets")); } catch (e) { /* raw export absent */ }
    return hits[0] || null;
  };
  const report = [];
  const rawMods = {}; // tableName -> { rowName: fields|null }
  for (const [i, e] of patch.edits.entries()) {
    const r = { index: i, target: e.target, ok: false, notes: [] };
    if (e.target === "DataTable") {
      const tp = e.table ? findTable(e.table) : null;
      if (!tp) { r.notes.push(`Table '${e.table}' not found anywhere under raw-export DataAssets/ -- name typo, or that folder isn't uploaded yet`); report.push(r); continue; }
      r.tableFile = path.relative(RAW_EXPORT_ROOT, tp).replace(/\\/g, "/");
      let rows = {};
      try { rows = JSON.parse(fs.readFileSync(tp, "utf-8"))[0].Rows || {}; }
      catch (err) { r.notes.push(`Table file unreadable: ${err.message}`); report.push(r); continue; }
      const exists = e.row in rows;
      if (e.op === "edit" || e.op === "delete") {
        if (!exists) { r.notes.push(`Row '${e.row}' does not exist (edit/delete needs an existing row). Nearby: ${Object.keys(rows).slice(0, 3).join(", ")}…`); report.push(r); continue; }
      } else if (e.op === "add") {
        if (exists) r.notes.push(`Row '${e.row}' ALREADY exists -- this add will overwrite it in-game`);
      } else { r.notes.push(`op must be edit/add/delete`); report.push(r); continue; }
      if (e.op !== "delete") {
        const sampleRow = rows[e.row] || Object.values(rows)[0] || {};
        for (const k of Object.keys(e.fields || {})) {
          if (!(k in sampleRow)) r.notes.push(`Field '${k}' not present on ${exists ? "this" : "a sample"} row -- UE will ignore unknown fields silently`);
        }
      }
      rawMods[e.table] = rawMods[e.table] || {};
      rawMods[e.table][e.row] = e.op === "delete" ? null : (e.fields || {});
      r.ok = true;
    } else if (e.target === "DataAsset") {
      const rel = String(e.asset || "");
      const full = path.join(RAW_EXPORT_ROOT, rel);
      if (rel.split(/[\\/]/).includes("..") || !fs.existsSync(full)) {
        r.notes.push(`Asset '${rel}' not found in raw-export`); report.push(r); continue;
      }
      r.ok = true;
      r.notes.push("DataAsset edits ride through RODSchema's typed loaders (e.g. weapons/) -- included in the package under mods/" + patch.name + "/dataassets/ for the loader that claims it");
    } else {
      r.notes.push("target must be DataTable or DataAsset");
    }
    report.push(r);
  }
  const files = Object.entries(rawMods).map(([table, rows]) => ({
    path: `mods/${patch.name}/raw/${table}.json`,
    content: JSON.stringify({ [table]: rows }, null, 1),
  }));
  res.json({ ok: report.every((r) => r.ok), report, files, note: "raw/ layout follows PalSchema's RawTableLoader convention: one JSON per table, { TableName: { RowName: fields | null-to-delete } }" });
});

/**
 * POST /api/rodschema/package  Body: { patches: [patchJson, ...] } (optional)
 * Streams a ZIP of the rodschema/ source tree (minus deps/ and .git --
 * see BUILD-INSTRUCTIONS.md inside for restoring deps via git
 * submodules), current signatures.json, the header-sync script, and
 * every posted patch converted to mod folders.
 * HONEST LIMIT, stated in the zip too: this server is Linux; RE-UE4SS
 * C++ mods require the MSVC toolchain, so the DLL itself must be
 * built on Windows (VS2022 + CMake -- build.ps1 is one command).
 */
app.post("/api/rodschema/package", (req, res) => {
  if (!fs.existsSync(RODSCHEMA_ROOT)) {
    return res.status(404).json({ error: "rodschema/ folder not deployed on this instance" });
  }
  const patches = (req.body && Array.isArray(req.body.patches)) ? req.body.patches : [];
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="RODSchema-package.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => res.destroy(err));
  archive.pipe(res);
  archive.glob("**/*", {
    cwd: RODSCHEMA_ROOT,
    ignore: ["deps/RE-UE4SS/**", "deps/json/**", "deps/safetyhook/**", ".git/**", "build/**"],
    dot: false,
  }, { prefix: "RODSchema/" });
  const instructions = [
    "# Building RODSchema (main.dll)",
    "",
    "This package was assembled by the ROD Database Toolkit. It contains the full",
    "RODSchema source, the CURRENT signatures.json from the toolkit's Memory",
    "Signatures editor, tools_sync_signatures.py, and any mod patches you packaged.",
    "",
    "## Why the toolkit can't build the DLL for you (honest limit)",
    "RE-UE4SS C++ mods require the MSVC x64 toolchain; the toolkit server is Linux.",
    "Cross-compiling RE-UE4SS with mingw is not supported upstream, so the build",
    "happens on Windows -- but it's one command once set up.",
    "",
    "## Steps (Windows)",
    "1. Install Visual Studio 2022 (Desktop C++ workload) + CMake + git.",
    "2. Restore dependencies (excluded from this zip for size):",
    "   git init && git submodule add https://github.com/UE4SS-RE/RE-UE4SS deps/RE-UE4SS",
    "   git submodule add https://github.com/nlohmann/json deps/json",
    "   git submodule add https://github.com/cursey/safetyhook deps/safetyhook",
    "   git submodule update --init --recursive",
    "   (or clone your existing RODSchema repo and copy this zip's src/include/assets/mods over it)",
    "3. Apply the toolkit-managed signatures into the header:",
    "   python tools_sync_signatures.py",
    "4. Build: powershell ./build.ps1   (VS2022 x64 -- produces main.dll)",
    "5. Install: ue4ss/Mods/RODSchema/dlls/main.dll + copy mods/ next to it; enabled.txt included.",
    "",
    "## Mods in this package",
    patches.length ? patches.map((p) => `- mods/${p.name}/ (from the toolkit's patch composer)`).join("\n") : "- (none packaged -- compose one in the RODSchema view's patch composer)",
  ].join("\n");
  archive.append(instructions + "\n", { name: "RODSchema/BUILD-INSTRUCTIONS.md" });
  for (const p of patches) {
    if (!p || !p.name || !/^[\w-]+$/.test(p.name)) continue;
    const rawMods = {};
    for (const e of p.edits || []) {
      if (e.target === "DataTable" && /^[\w-]+$/.test(e.table || "") && e.row) {
        rawMods[e.table] = rawMods[e.table] || {};
        rawMods[e.table][e.row] = e.op === "delete" ? null : (e.fields || {});
      }
    }
    for (const [table, rows] of Object.entries(rawMods)) {
      archive.append(JSON.stringify({ [table]: rows }, null, 1), { name: `RODSchema/mods/${p.name}/raw/${table}.json` });
    }
    archive.append(JSON.stringify({ name: p.name, author: p.author || "", version: p.version || "1.0.0", description: p.description || "Built with the ROD Database Toolkit" }, null, 1),
      { name: `RODSchema/mods/${p.name}/metadata.json` });
  }
  archive.finalize();
});

/**
 * POST /api/luamods/package  Body: { name, lua }
 * Streams a ready-to-install UE4SS Lua mod folder as a ZIP:
 * <name>/Scripts/main.lua + <name>/enabled.txt.
 */
app.post("/api/luamods/package", (req, res) => {
  // Two body shapes: { name, lua } (single main.lua -- the original)
  // or { name, files: [{ path, content }] } for multi-file mods
  // (config.lua + features/*, the structure the working example mods
  // use). Paths are mod-relative, traversal rejected.
  const { name, lua, files } = req.body || {};
  if (!name || !/^[\w-]+$/.test(name)) {
    return res.status(400).json({ error: "Body must include a name (letters/digits/_/-)" });
  }
  const fileList = Array.isArray(files) && files.length
    ? files
    : (typeof lua === "string" && lua.trim() ? [{ path: "Scripts/main.lua", content: lua }] : null);
  if (!fileList) {
    return res.status(400).json({ error: "Provide lua (single script) or files: [{path, content}]" });
  }
  for (const f of fileList) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string"
        || f.path.split(/[\\/]/).includes("..") || f.path.startsWith("/")) {
      return res.status(400).json({ error: `Invalid file entry: ${JSON.stringify(f && f.path)}` });
    }
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => res.destroy(err));
  archive.pipe(res);
  for (const f of fileList) archive.append(f.content, { name: `${name}/${f.path}` });
  archive.append("", { name: `${name}/enabled.txt` });
  archive.append(`# ${name}\n\nGenerated by the ROD Database Toolkit's Lua Scripting view.\nInstall: copy this folder into ue4ss/Mods/ (enabled.txt keeps it active).\n`, { name: `${name}/README.md` });
  archive.finalize();
});

/**
 * GET /api/rodschema/patch-examples
 * Preset patches for the composer, built by CLONING REAL ROWS from the
 * current raw export at request time -- field names and shapes are the
 * game's own, never a hand-typed guess that drifts. Each preset covers
 * the FULL set of touchpoints the game's standard uses for that
 * content type, with per-edit `note` fields explaining what each table
 * does, and honest `_limitations` where a touchpoint isn't a DataTable
 * (ItemDataAsset stats = DataAsset via the typed loader; display
 * names/descriptions = StringTable localization, which RawTableLoader
 * does NOT cover yet -- keys are listed so nothing is forgotten).
 */
app.get("/api/rodschema/patch-examples", (req, res) => {
  const readRows = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(RAW_EXPORT_ROOT, rel), "utf-8"))[0].Rows || {}; }
    catch (e) { return null; }
  };
  const sampleRow = (rows, preferKey) => {
    if (!rows) return null;
    if (preferKey && rows[preferKey]) return { key: preferKey, fields: rows[preferKey] };
    const k = Object.keys(rows)[0];
    return k ? { key: k, fields: rows[k] } : null;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const examples = [];
  const missing = [];

  const equipDb = readRows("DataAssets/Database/DT_EquipmentDatabase.json");
  const itemDb = readRows("DataAssets/Database/DT_ItemDatabase.json");
  // Per-category tables (real names checked on disk -- there is no
  // generic DT_WeaponThumbnail; each weapon category has its own).
  const wThumb = readRows("DataAssets/Items/ThumbnailDataTable/DT_OneHandedSwordThumbnail.json");
  const sThumb = readRows("DataAssets/Items/ThumbnailDataTable/DT_ShieldThumbnail.json");
  const wImpostor = readRows("DataAssets/Items/ImpostorDataTable/DT_OneHandedSwordImpostor.json");
  const shopRows = readRows("DataAssets/Games/DataTables/DT_ShopItemList.json");

  const locNote = (keys) =>
    `LOCALIZATION (display name/description) lives in StringTable assets (Localization/Game/{lang}/Game.json → ST_GeneralLocalizeList), NOT DataTables — RawTableLoader can't patch those yet (a UStringTable loader is future work). Add these keys when that lands, or names show as raw keys in-game exactly like the toolkit does: ${keys.join(", ")}`;

  // ---- Add a weapon ----
  if (equipDb && wThumb && wImpostor) {
    const db = sampleRow(equipDb);
    const th = sampleRow(wThumb);
    const im = sampleRow(wImpostor);
    examples.push({
      label: "Add a weapon (One-Handed Sword #90)",
      patch: {
        name: "AddWeapon_WOS90", author: "you", version: "1.0.0",
        _limitations: [
          "The weapon's STATS live in ItemDataAsset.json → WeaponOSItemDataAsMap (a DataAsset map, not a DataTable) — that edit is the DataAsset entry below, applied by RODSchema's typed RODWeaponModLoader at GameInstance Init (class path confirmed; vtable index still pending).",
          locNote(["ItemName_WOS_90", "ItemDescription_WOS_90"]),
          "Icon textures: the thumbnail row points at a texture — ship the T_Item_*.png in your pak or reuse an existing one.",
        ],
        edits: [
          { target: "DataTable", table: "DT_EquipmentDatabase", op: "add", row: "WOS_90",
            note: "In-game Database menu entry (clone of a real row — adjust the title/description keys and unlock condition).",
            fields: clone(db.fields) },
          { target: "DataTable", table: "DT_OneHandedSwordThumbnail", op: "add", row: "WOS_90",
            note: "Inventory/shop icon binding (cloned real shape).",
            fields: clone(th.fields) },
          { target: "DataTable", table: "DT_OneHandedSwordImpostor", op: "add", row: "WOS_90",
            note: "3D impostor/billboard binding for the equip screen (cloned real shape).",
            fields: clone(im.fields) },
          { target: "DataAsset", asset: "DataAssets/Items/ItemDataAsset.json",
            property: "WeaponOSItemDataAsMap",
            note: "STATS: add key 90 here with ATK/ACV/etc — handled by RODWeaponModLoader (typed DataAsset loader), not RawTableLoader." },
        ],
      },
    });
  } else missing.push("weapon preset (DT_EquipmentDatabase / DT_OneHandedSwordThumbnail / DT_OneHandedSwordImpostor not all uploaded)");

  // ---- Add an item ----
  if (itemDb) {
    const db = sampleRow(itemDb);
    examples.push({
      label: "Add an item (Material #300)",
      patch: {
        name: "AddItem_Material300", author: "you", version: "1.0.0",
        _limitations: [
          "Item definition itself lives in ItemDataAsset.json → MaterialItemDataAsMap (DataAsset — typed-loader territory, entry below).",
          locNote(["ItemName_Material_300", "ItemDescription_Material_300"]),
        ],
        edits: [
          { target: "DataTable", table: "DT_ItemDatabase", op: "add", row: "Material_300",
            note: "In-game Database menu entry (cloned real row shape).",
            fields: clone(db.fields) },
          { target: "DataAsset", asset: "DataAssets/Items/ItemDataAsset.json",
            property: "MaterialItemDataAsMap",
            note: "The item's actual definition (category, sell value, icon id) — typed DataAsset loader." },
        ],
      },
    });
  } else missing.push("item preset (DT_ItemDatabase not uploaded)");

  // ---- Add armor/shield ----
  if (equipDb && sThumb) {
    const db = sampleRow(equipDb, "Shield_3") || sampleRow(equipDb);
    const th = sampleRow(sThumb);
    examples.push({
      label: "Add a shield (#40)",
      patch: {
        name: "AddShield_40", author: "you", version: "1.0.0",
        _limitations: [
          "Stats live in ItemDataAsset.json → ShieldItemDataAsMap (DataAsset entry below). Armor (Upper/Lower/Glove) is identical with its own map + DT_{Cat}Thumbnail table.",
          "3D model: shields bind a mesh via DataAssets/AvatarParts/Equipment/Shield/AvatarParts_Shield_000XX.json → ShieldMesh (DataAsset, one file per id — ship yours in the pak).",
          locNote(["ItemName_Shield_40", "ItemDescription_Shield_40"]),
        ],
        edits: [
          { target: "DataTable", table: "DT_EquipmentDatabase", op: "add", row: "Shield_40",
            note: "Database menu entry (cloned from the real Shield_3 row where available).",
            fields: clone(db.fields) },
          { target: "DataTable", table: "DT_ShieldThumbnail", op: "add", row: "Shield_40",
            note: "Icon binding (cloned real shape).",
            fields: clone(th.fields) },
          { target: "DataAsset", asset: "DataAssets/Items/ItemDataAsset.json",
            property: "ShieldItemDataAsMap",
            note: "DEF/stats — typed DataAsset loader." },
        ],
      },
    });
  } else missing.push("shield preset (DT_EquipmentDatabase / DT_ShieldThumbnail not uploaded)");

  // ---- Shop edits (item to shop / recipe to shop) ----
  if (shopRows && shopRows.Shop) {
    const shopEdit = clone(shopRows.Shop);
    if (shopEdit.ShopList && shopEdit.ShopList[0]) {
      shopEdit.ShopList[0].Value.Items.push({ Category: "EItemCategory::ItemCategory_Cost", ItemId: 999 });
    }
    examples.push({
      label: "Add an item/recipe to Shop 1 (edit the single Shop row)",
      patch: {
        name: "AddShopStock", author: "you", version: "1.0.0",
        _limitations: [
          "DT_ShopItemList is ONE row ('Shop') carrying ShopList + YellCoinShopItems + MerchantCreateList + BlacksmithCreateList — editing ANY stock means rewriting that whole row (this preset clones the real row and appends Cost ItemId 999 to Shop 1). Shops sell recipe tokens: the Cost ItemId must exist in ItemDataAsset's CostItemDataAsMap and map to your recipe.",
        ],
        edits: [
          { target: "DataTable", table: "DT_ShopItemList", op: "edit", row: "Shop",
            note: "Full cloned row with your addition appended — the ONLY safe way to edit a struct-array field.",
            fields: shopEdit },
        ],
      },
    });
  } else missing.push("shop preset (DT_ShopItemList not uploaded)");

  // ---- Add a recipe ----
  examples.push({
    label: "Add a recipe (weapon/armor/item)",
    patch: {
      name: "AddRecipe_WOS90", author: "you", version: "1.0.0",
      _limitations: [
        "Recipes live ENTIRELY in ItemDataAsset.json (RecipeItemDataAsMap for the recipe token + CostItemDataAsMap linkage) — DataAsset territory, so this preset is a typed-loader worksheet rather than raw table rows. Sell it in a shop with the 'Add to Shop' preset once its Cost id exists.",
        locNote(["ItemName_Recipe_WOS_90"]),
      ],
      edits: [
        { target: "DataAsset", asset: "DataAssets/Items/ItemDataAsset.json",
          property: "RecipeItemDataAsMap",
          note: "Add the recipe entry: result item key, material item ids + counts, craft level — copy a sibling entry's exact shape from the raw file (DT Inspector shows it)." },
        { target: "DataAsset", asset: "DataAssets/Items/ItemDataAsset.json",
          property: "CostItemDataAsMap",
          note: "Add the Cost token that shops sell, pointing at the recipe." },
      ],
    },
  });

  // ---- Fill the shops with EVERY recipe the game has ----
  // Both presets rewrite the whole 'Shop' row (the only safe way to
  // edit its struct arrays), with ids pulled from the REAL recipe maps
  // at request time -- so they stay correct as the game patches instead
  // of freezing a hand-typed id list.
  const itemAsset = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(RAW_EXPORT_ROOT, "DataAssets/Items/ItemDataAsset.json"), "utf-8"))[0].Properties; }
    catch (e) { return null; }
  })();
  if (shopRows && shopRows.Shop && itemAsset) {
    const costIds = [];
    for (const [mapName, entries] of Object.entries(itemAsset)) {
      if (!mapName.includes("Recipe") || !Array.isArray(entries)) continue;
      for (const e of entries) {
        const idata = (e.Value || {}).ItemData || {};
        if (String(idata.Category || "").endsWith("_Cost") && idata.ItemId != null) costIds.push(idata.ItemId);
      }
    }
    const uniqueCost = [...new Set(costIds)].sort((a, b) => a - b);

    const filled = clone(shopRows.Shop);
    if (filled.ShopList && filled.ShopList[0]) {
      filled.ShopList[0].Value.Items = uniqueCost.map((id) => ({ Category: "EItemCategory::ItemCategory_Cost", ItemId: id }));
    }
    if (Array.isArray(filled.MerchantCreateList)) {
      const rank1 = filled.MerchantCreateList.find((m) => String(m.Key) === "1");
      if (rank1) rank1.Value.Recipe = uniqueCost.slice();
    }
    examples.push({
      label: `Fill the Item Seller -- all ${uniqueCost.length} recipes at rank 1`,
      patch: {
        name: "FillItemShop", author: "you", version: "1.0.0",
        _limitations: [
          `Rewrites the whole 'Shop' row: ShopList shop 1 and MerchantCreateList rank 1 both get all ${uniqueCost.length} Cost-token recipe ids in the current export. These are the CONSUMABLE recipes -- weapon/armor recipes are NOT Cost tokens (different id space; use the Smithy preset).`,
          "Prices come from each recipe's own BuyAmount in ItemDataAsset -- unchanged here.",
        ],
        edits: [
          { target: "DataTable", table: "DT_ShopItemList", op: "edit", row: "Shop",
            note: "Full cloned row, shop 1 + merchant rank 1 stocked with every recipe id (generated from your real export).",
            fields: filled },
        ],
      },
    });

    const kindToMap = {
      Upper: "UpperRecipeDataAsMap", Glove: "GloveRecipeDataAsMap", Lower: "LowerRecipeDataAsMap",
      Shield: "ShieldRecipeDataAsMap", OneHandedSword: "OneHandedSwordWeaponRecipeDataAsMap",
      Rapier: "RapierWeaponRecipeDataAsMap", Dagger: "DaggerWeaponRecipeDataAsMap",
      Mace: "MaceWeaponRecipeDataAsMap", TwoHandedSword: "TwoHandedSwordWeaponRecipeDataAsMap",
      Axe: "AxeWeaponRecipeDataAsMap",
    };
    const kindLists = [];
    let kindTotal = 0;
    for (const [kind, mapName] of Object.entries(kindToMap)) {
      const ids = (itemAsset[mapName] || []).map((e) => parseInt(e.Key, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
      if (ids.length) {
        kindLists.push({ Key: `ERecipeKind::${kind}`, Value: { Recipe: ids } });
        kindTotal += ids.length;
      }
    }
    const filledSmith = clone(shopRows.Shop);
    if (Array.isArray(filledSmith.BlacksmithCreateList)) {
      const rank1 = filledSmith.BlacksmithCreateList.find((b) => String(b.Key) === "1");
      if (rank1) rank1.Value.List = kindLists;
    }
    examples.push({
      label: `Fill the Smithy -- all ${kindTotal} weapon/armor/shield recipes at rank 1`,
      patch: {
        name: "FillBlacksmith", author: "you", version: "1.0.0",
        _limitations: [
          `Rewrites the whole 'Shop' row: BlacksmithCreateList rank 1 gets every equipment recipe in the export (${kindTotal} across ${kindLists.length} ERecipeKind buckets). Vanilla rank 1 is EMPTY -- the smithy unlocks by rank, so this is what "everything at base level" means.`,
          'These ids are recipe-map KEYS scoped by kind (Upper #5001 = UpperRecipeDataAsMap["5001"]) -- a DIFFERENT id space from the shop Cost tokens. Mixing them up silently yields the wrong item, which is why the two presets are separate.',
        ],
        edits: [
          { target: "DataTable", table: "DT_ShopItemList", op: "edit", row: "Shop",
            note: "Full cloned row, blacksmith rank 1 stocked with every equipment recipe (generated from your real export).",
            fields: filledSmith },
        ],
      },
    });
  }

  res.json({ examples, missing, note: "Every DataTable 'fields' object above is a CLONE of a real row from your current export — edit values, keep the shape." });
});

/**
 * POST /api/pipeline/upload-sdk-zip   Body: raw ZIP bytes
 * A Dumper-7 dump (the zip the tool produces, e.g.
 * "5.3.2-0+++ROD-App-ONE+release-1.0.3-EchoesofAincrad"). Validated by
 * SHAPE before extraction -- it must contain CppSDK/SDK/ROD_structs.hpp,
 * which is what makes it THIS game's dump and not some other zip. Lands
 * in raw-export/GameSDK/<version>/ (versioned, so release-1.0.3 and
 * beta-1.0 coexist instead of overwriting each other), and the .usmap is
 * ALSO copied to raw-export/Mappings/ where FModel/UE4SS users expect it.
 */
app.post("/api/pipeline/upload-sdk-zip", async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "No ZIP data received" });
  }
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const zipPath = path.join(UPLOAD_TMP_DIR, `sdk-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, req.body);

  const run = (cmd, args) => new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("close", (code) => resolve({ code, out, err }));
    proc.on("error", (e) => resolve({ code: -1, out: "", err: e.message, spawnError: true }));
  });

  try {
    const list = await run("unzip", ["-l", zipPath]);
    if (list.spawnError) return res.status(500).json({ error: `Server missing "unzip": ${list.err}` });
    if (list.code !== 0) return res.status(400).json({ error: "Not a valid ZIP file" });
    if (!/CppSDK[\\/]SDK[\\/]ROD_structs\.hpp/.test(list.out)) {
      return res.status(400).json({
        error: "This ZIP has no CppSDK/SDK/ROD_structs.hpp -- it doesn't look like a Dumper-7 dump of Echoes of Aincrad. Refusing to extract.",
      });
    }
    // Version folder = the dump's own top-level folder name (Dumper-7
    // names it after the game build), sanitized for the filesystem.
    const topLine = list.out.split("\n").find((l) => /CppSDK[\\/]SDK[\\/]ROD_structs\.hpp/.test(l)) || "";
    const rel = (topLine.trim().split(/\s+/).slice(3).join(" ") || "").replace(/\\/g, "/");
    const rawTop = rel.split("/CppSDK/")[0] || "dump";
    const version = rawTop.replace(/[^\w.+-]+/g, "_").slice(0, 120) || "dump";

    const destRoot = path.join(PROJECT_ROOT, "raw-export", "GameSDK", version);
    fs.rmSync(destRoot, { recursive: true, force: true });
    fs.mkdirSync(destRoot, { recursive: true });
    const tmpExtract = path.join(UPLOAD_TMP_DIR, `sdk-x-${Date.now()}`);
    const ex = await run("unzip", ["-oq", zipPath, "-d", tmpExtract]);
    if (ex.code !== 0) return res.status(500).json({ error: `Extraction failed: ${ex.err.slice(0, 400)}` });

    // Move the dump's inner folder up so paths are GameSDK/<version>/CppSDK/...
    const inner = fs.readdirSync(tmpExtract).map((f) => path.join(tmpExtract, f))
      .find((p2) => fs.statSync(p2).isDirectory() && fs.existsSync(path.join(p2, "CppSDK")));
    const srcRoot = inner || tmpExtract;
    for (const entry of fs.readdirSync(srcRoot)) {
      fs.cpSync(path.join(srcRoot, entry), path.join(destRoot, entry), { recursive: true });
    }
    fs.rmSync(tmpExtract, { recursive: true, force: true });

    // Mapping files go to BOTH places, because they serve two different
    // consumers and putting them in only one was the bug:
    //   raw-export/Mappings/  -- where FModel/UE4SS users look on disk.
    //   mapping-files/{major}/{minor}/{patch}/{build}/{usmap|ida}/  --
    //     the VERSIONED store Data Coverage's "Direct" buttons read.
    // The SDK upload previously wrote only the first, so Data Coverage
    // kept advertising whatever had been hand-placed earlier (the 1.0.1.0
    // beta files) even after a 1.0.3 dump was uploaded. Shipping data to
    // a folder nothing reads is the same as not shipping it.
    //
    // The game version is parsed from the dump's own name, which Dumper-7
    // builds from the game build string:
    //   5.3.2-0+++ROD-App-ONE+release-1.0.3-EchoesofAincrad -> 1.0.3(.0)
    // If it can't be parsed we do NOT invent one -- the file still lands
    // in raw-export/Mappings/ and the response says the versioned copy
    // was skipped and why.
    const pad = (n) => String(n).padStart(8, "0");
    const verMatch = /(?:release|beta|demo|patch)-(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(version);
    const gameVersion = verMatch
      ? [verMatch[1], verMatch[2], verMatch[3] || "0", verMatch[4] || "0"].map(Number)
      : null;

    const mapDir = path.join(destRoot, "Mappings");
    const idaDir = path.join(destRoot, "IDAMappings");
    const sharedMapDir = path.join(PROJECT_ROOT, "raw-export", "Mappings");
    const mappings = [];
    const versioned = [];
    fs.mkdirSync(sharedMapDir, { recursive: true });

    const placeMappingFile = (srcFile, filename, type) => {
      fs.copyFileSync(srcFile, path.join(sharedMapDir, filename));
      mappings.push(filename);
      if (!gameVersion) return;
      const destDir = path.join(MAPPING_FILES_ROOT, ...gameVersion.map(pad), type);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcFile, path.join(destDir, filename));
      versioned.push(`${type}/${filename}`);
    };

    if (fs.existsSync(mapDir)) {
      for (const f of fs.readdirSync(mapDir)) {
        if (f.endsWith(".usmap")) placeMappingFile(path.join(mapDir, f), f, "usmap");
      }
    }
    if (fs.existsSync(idaDir)) {
      for (const f of fs.readdirSync(idaDir)) {
        if (f.endsWith(".idmap")) placeMappingFile(path.join(idaDir, f), f, "ida");
      }
    }
    const countFiles = (dir) => fs.existsSync(dir)
      ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).length : 0;

    res.json({
      ok: true,
      version,
      sdkFiles: countFiles(path.join(destRoot, "CppSDK")),
      mappingsCopied: mappings,
      gameVersion: gameVersion ? gameVersion.join(".") : null,
      versionedMappings: versioned,
      versionedSkippedReason: gameVersion ? null
        : `Could not parse a game version out of "${version}" -- the mapping files are in raw-export/Mappings/, but NOT in the versioned mapping-files/ store that Data Coverage's Direct buttons read. Place them by hand under mapping-files/{major}/{minor}/{patch}/{build}/{usmap|ida}/ if you need those buttons.`,
      note: "Run the 'Game SDK (Dumper-7)' focus group to index it (types, enums, DataTable row structs, DataAsset classes).",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
});

/**
 * GET /api/sdk/ue-project-zip
 * Generates a UE 5.3.2 -PROJECT-READY C++ module from the indexed
 * Dumper-7 dump and streams it: RODGameEnums.h / RODGameStructs.h /
 * RODGameDataAssets.h (UHT-visible UENUM/USTRUCT/UCLASS with
 * GENERATED_BODY + UPROPERTY), a .Build.cs, the .usmap, and
 * INSTRUCTIONS.md. The raw Dumper-7 headers are NOT what a UE project
 * can consume (raw offsets, Pad_ members, no UHT macros) -- these are
 * regenerated from the same ground truth, which is the whole point.
 */
app.get("/api/sdk/ue-project-zip", (req, res) => {
  const sdkIndexPath = path.join(PROJECT_ROOT, "Content", "ROD", "DataAssets", "Database", "SDK", "_index.json");
  let idx;
  try { idx = JSON.parse(fs.readFileSync(sdkIndexPath, "utf-8")); }
  catch (e) {
    return res.status(409).json({ error: "No Game SDK indexed yet -- upload a Dumper-7 dump on the Build Dashboard and run the 'Game SDK' section." });
  }
  const dumpRoot = path.join(PROJECT_ROOT, "raw-export", "GameSDK", idx.primaryDump);
  const outDir = path.join(UPLOAD_TMP_DIR, `uesdk-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const gen = spawn("python3", [path.join(PROJECT_ROOT, "tools", "game_sdk.py"), dumpRoot,
    "--out", outDir, "--emit-ue", "--plugin-name", "RODGameSDK"], { cwd: path.join(PROJECT_ROOT, "tools") });
  let genErr = "";
  gen.stderr.on("data", (d) => { genErr += d; });
  gen.on("close", (code) => {
    if (code !== 0) return res.status(500).json({ error: `SDK generation failed: ${genErr.slice(0, 800)}` });

    const buildCs = [
      "using UnrealBuildTool;",
      "",
      "public class RODGameSDK : ModuleRules",
      "{",
      "\tpublic RODGameSDK(ReadOnlyTargetRules Target) : base(Target)",
      "\t{",
      "\t\tPCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;",
      "\t\tPublicDependencyModuleNames.AddRange(new string[] { \"Core\", \"CoreUObject\", \"Engine\" });",
      "\t}",
      "}",
    ].join("\n");

    const instructions = [
      `# Echoes of Aincrad — UE 5.3.2 SDK module`,
      "",
      `Generated by the ROD Database Toolkit from the game's own Dumper-7 dump`,
      `**${idx.primaryDump}** (module ROD): ${idx.enumCount} enums, ${idx.structCount} structs, ${idx.classCount} classes —`,
      `including **${idx.dataTableRowStructs.length} DataTable row structs** and **${idx.dataAssetClasses.length} DataAsset classes**.`,
      "",
      "## What this is (and what it is NOT)",
      "Dumper-7's own headers are built for EXTERNAL tooling: raw offsets, `Pad_` filler",
      "members, `DUMPER7_ASSERTS_*`, and no UHT macros. They do not compile in a UE project.",
      "These headers are the same types RE-EXPRESSED as UHT-visible declarations",
      "(`UENUM`/`USTRUCT`/`UCLASS` + `GENERATED_BODY()` + `UPROPERTY`), which is what a UE",
      "project can actually use to author DataTables and DataAssets that match the game.",
      "Binary offsets are deliberately NOT reproduced — UE recomputes layout, and for",
      "editor-side authoring only the FIELD NAMES AND TYPES need to match. They do.",
      "",
      "## Install into your UE 5.3.2 project",
      "1. Copy the `RODGameSDK/` folder into your project's `Source/` directory.",
      "2. Add the module to your `.uproject`:",
      '   `{ "Name": "RODGameSDK", "Type": "Runtime", "LoadingPhase": "Default" }`',
      "3. Add `\"RODGameSDK\"` to your primary module's `PublicDependencyModuleNames` in its `.Build.cs`.",
      "4. Right-click the `.uproject` → **Generate Visual Studio project files**, then build.",
      "",
      "## Using it",
      "- **DataTables:** create a Data Table asset and pick a row struct (e.g. `FCommonItemDataTable`,",
      "  `FKeyItemDataTable`, `FShopItemListData`). Import the toolkit's exported JSON rows against it.",
      "- **DataAssets:** `URODItemDataAsset` carries the real `TMap<int32, F...ItemData>` properties",
      "  (`UseItemDataAsMap`, `KeyItemDataAsMap`, `OneHandedSwordWeaponItemDataAsMap`, …) — the exact",
      "  containers RODSchema's typed loaders patch at runtime.",
      "- **Mappings:** `Mappings/*.usmap` is included — point FModel (or UE4SS) at it to read the",
      "  game's paks with full property names.",
      "",
      "## Row structs in this dump",
      idx.dataTableRowStructs.map((r) => `- ${r}`).join("\n"),
      "",
      "## DataAsset classes",
      idx.dataAssetClasses.map((c) => `- ${c}`).join("\n"),
      "",
      "Engine types referenced (from `Engine`/`CoreUObject`, not redeclared here) resolve via the",
      "module's dependencies — that's why the `.Build.cs` includes Core, CoreUObject and Engine.",
    ].join("\n");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="RODGameSDK-${idx.primaryDump}.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.destroy(err));
    archive.pipe(res);
    for (const f of ["RODGameEnums.h", "RODGameStructs.h", "RODGameDataAssets.h"]) {
      const p2 = path.join(outDir, f);
      if (fs.existsSync(p2)) archive.file(p2, { name: `RODGameSDK/Public/${f}` });
    }
    archive.append(buildCs + "\n", { name: "RODGameSDK/RODGameSDK.Build.cs" });
    archive.append(instructions + "\n", { name: "INSTRUCTIONS.md" });
    for (const m of (idx.mappings || [])) {
      const mp = path.join(PROJECT_ROOT, "raw-export", m.path);
      if (fs.existsSync(mp)) archive.file(mp, { name: `Mappings/${m.file}` });
    }
    archive.finalize();
  });
});

/**
 * GET /api/pipeline/focus-groups
 * The focus-group registry, dependency-expanded, computed fresh (no
 * section runs -- it's milliseconds). The dashboard used to read groups
 * out of the CACHED status report, so a newly added group stayed
 * invisible until someone re-ran the multi-minute checks. That's how the
 * Game SDK button went missing; this endpoint removes the dependency.
 */
/**
 * POST /api/pipeline/clear-progress
 * Dismisses an INTERRUPTED progress file (a run killed before it could
 * finish). Refuses while a build is genuinely alive -- clearing a live
 * run's progress would only blind the dashboard, not stop anything.
 */
app.post("/api/pipeline/clear-progress", (req, res) => {
  if (currentBuildJob && currentBuildJob.running) {
    return res.status(409).json({ error: "A build is running right now -- nothing to clear." });
  }
  const p = path.join(PROJECT_ROOT, ".pipeline-progress.json");
  let progress = null;
  try { progress = JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { /* nothing to clear */ }
  if (progress && progress.running && progress.pid) {
    try {
      process.kill(progress.pid, 0);
      return res.status(409).json({ error: `Process ${progress.pid} is still running this build -- refusing to clear a live run.` });
    } catch (e) { /* not alive: safe to clear */ }
  }
  // Mark it finished-as-interrupted rather than deleting: the per-section
  // states are the useful record of HOW FAR it got, and throwing that
  // away to fix a stuck button would be losing information to fix UI.
  if (progress) {
    progress.running = false;
    progress.success = false;
    progress.interrupted = true;
    progress.finishedAt = new Date().toISOString();
    for (const s of progress.sections || []) {
      if (s.state === "running" || s.state === "pending") {
        s.state = s.state === "running" ? "interrupted" : "skipped";
      }
    }
    fs.writeFileSync(p, JSON.stringify(progress, null, 1));
  }
  res.json({ ok: true, cleared: Boolean(progress) });
});

/**
 * POST /api/runtime-dump/chests
 * Accepts ChestLocations.json produced by the ChestLocatorDump Lua mod
 * (UE4SS reads LocatorName + world location off the live ARODTBoxBase
 * actors -- no memory scanning or signatures involved). Lands in
 * raw-export/RuntimeDumps/, where the Chests section merges it.
 *
 * Validated by SHAPE, and MERGED rather than replaced: chests only exist
 * while their level is streamed in, so a dump is necessarily partial.
 * Overwriting would mean each sweep destroyed the last one's findings --
 * the file is meant to accumulate across sessions.
 */
app.post("/api/runtime-dump/chests", express.json({ limit: "20mb" }), (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.chests)) {
    return res.status(400).json({ error: "Expected a ChestLocations.json with a 'chests' array (from the ChestLocatorDump Lua mod)." });
  }
  const valid = incoming.chests.filter(
    (c) => c && typeof c.chestId === "string" && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z));
  if (!valid.length) {
    return res.status(400).json({ error: "No usable records: each chest needs chestId + numeric x/y/z." });
  }

  const dir = path.join(PROJECT_ROOT, "raw-export", "RuntimeDumps");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ChestLocations.json");

  const byId = new Map();
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf-8"));
      for (const c of prev.chests || []) byId.set(c.chestId, c);
    } catch (e) { /* corrupt previous file: the new one replaces it */ }
  }
  const before = byId.size;
  for (const c of valid) byId.set(c.chestId, c);

  const merged = {
    capturedBy: incoming.capturedBy || "ChestLocatorDump",
    updatedAt: new Date().toISOString(),
    count: byId.size,
    chests: [...byId.values()].sort((a, b) => a.chestId.localeCompare(b.chestId)),
  };
  fs.writeFileSync(file, JSON.stringify(merged, null, 1));

  res.json({
    ok: true,
    received: valid.length,
    newChests: byId.size - before,
    totalKnown: byId.size,
    note: "Merged into raw-export/RuntimeDumps/ChestLocations.json. Rebuild the Items or World group to put the pins on the map.",
  });
});

// ---------------------------------------------------------------
// Wwise audio: preview + download
// ---------------------------------------------------------------
// .wem is Wwise's own container. Every file in this game is Wwise
// Vorbis (format tag 0xFFFF -- checked, not assumed), which NO browser
// can play and ffmpeg alone cannot decode ("no decoder found"). So:
//   * DOWNLOAD always works -- it just serves the raw .wem, no tools.
//   * PREVIEW needs vgmstream, which decodes Wwise Vorbis to WAV. If
//     ffmpeg is also present we re-encode to Ogg (~5x smaller, and every
//     browser plays it); if not, the WAV is served as-is, which browsers
//     also play. Decoded files are cached, so each is converted once.
// If no decoder is installed we say so precisely instead of shipping a
// play button that silently does nothing.
// Same either-location tolerance as the pipeline: correct is
// Content/WwiseAudio (a sibling of ROD), but an older server build filed it
// inside ROD/, and those installs must still play audio.
const AUDIO_ROOT = (() => {
  const correct = path.join(PROJECT_ROOT, "raw-export", "Content", "WwiseAudio");
  const legacy = path.join(PROJECT_ROOT, "raw-export", "Content", "ROD", "WwiseAudio");
  if (fs.existsSync(correct)) return correct;
  if (fs.existsSync(legacy)) return legacy;
  return correct;
})();
const AUDIO_CACHE = path.join(PROJECT_ROOT, ".audio-cache");

function findVgmstream() {
  const candidates = [
    path.join(PROJECT_ROOT, "tools", "bin", "vgmstream-cli"),
    "/usr/local/bin/vgmstream-cli",
    "/usr/bin/vgmstream-cli",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const which = spawnSync("which", ["vgmstream-cli"], { encoding: "utf-8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const which2 = spawnSync("which", ["vgmstream_cli"], { encoding: "utf-8" });
  if (which2.status === 0 && which2.stdout.trim()) return which2.stdout.trim();
  return null;
}
function ffmpegPath() {
  // Prefer a copy we installed ourselves (tools/bin), then PATH.
  const local = path.join(PROJECT_ROOT, "tools", "bin", "ffmpeg");
  if (fs.existsSync(local)) return local;
  const which = spawnSync("which", ["ffmpeg"], { encoding: "utf-8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function hasFfmpeg() {
  return Boolean(ffmpegPath());
}

/**
 * Can ffmpeg actually ENCODE Ogg Vorbis?
 *
 * "ffmpeg exists" is not the same as "ffmpeg can make an .ogg". Minimal and
 * distro-stripped builds routinely ship without libvorbis, and then the
 * encode fails -- which is exactly what happened: .wav downloaded fine
 * (vgmstream alone produces it), .ogg failed, and PLAYBACK failed too
 * because preview preferred Ogg and had no fallback when the encode blew
 * up. Checking the encoder list once, at boot, turns that into a known
 * capability instead of a runtime surprise.
 */
let _vorbisCache = null;
function canEncodeVorbis() {
  if (_vorbisCache !== null) return _vorbisCache;
  const bin = ffmpegPath();
  if (!bin) { _vorbisCache = false; return false; }
  const r = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf-8" });
  _vorbisCache = r.status === 0 && /libvorbis|\bvorbis\b/.test(r.stdout || "");
  return _vorbisCache;
}

app.get("/api/audio/status", (req, res) => {
  const vgm = findVgmstream();
  res.json({
    ffmpeg: ffmpegPath(),
    canEncodeOgg: canEncodeVorbis(),
    audioRootPresent: fs.existsSync(AUDIO_ROOT),
    vgmstream: vgm,
    ffmpeg: hasFfmpeg(),
    canPreview: Boolean(vgm),
    previewFormat: vgm ? (hasFfmpeg() ? "ogg" : "wav") : null,
    installHint: vgm ? null
      : "Preview needs vgmstream (it decodes Wwise Vorbis; ffmpeg cannot). Download the Linux CLI build from https://github.com/vgmstream/vgmstream/releases and put the `vgmstream-cli` binary at tools/bin/vgmstream-cli (chmod +x), or install it on PATH. Downloads of the raw .wem work without it.",
  });
});

// Resolve a media path safely: it must stay inside WwiseAudio and end .wem.
function resolveWem(relPath) {
  if (!relPath || !relPath.endsWith(".wem")) return null;
  const full = path.resolve(AUDIO_ROOT, relPath);
  if (!full.startsWith(path.resolve(AUDIO_ROOT) + path.sep)) return null; // path traversal
  return fs.existsSync(full) ? full : null;
}

/**
 * GET /api/audio/download?path=...&format=wem|wav|ogg
 * wem  -- the raw file, no dependencies, always works.
 * wav  -- decoded (vgmstream). Lossless, big.
 * ogg  -- decoded + re-encoded (vgmstream -> ffmpeg). ~5x smaller.
 * Converted files are CACHED, so the second request for the same file is
 * a straight file read.
 */
app.get("/api/audio/download", (req, res) => {
  const rel = req.query.path;
  const full = resolveWem(rel);
  if (!full) return res.status(404).json({ error: "No such .wem in the export." });

  const format = (req.query.format || "wem").toLowerCase();
  if (format === "wem") {
    return res.download(full, path.basename(full));
  }
  if (format !== "wav" && format !== "ogg") {
    return res.status(400).json({ error: "format must be wem, wav or ogg" });
  }

  convertWem(rel, full, format, (err, file) => {
    if (err) return res.status(err.status || 500).json({ error: err.message, detail: err.detail });
    res.download(file, path.basename(full).replace(/\.wem$/i, "." + format));
  });
});

/**
 * Decode a .wem to wav or ogg, cached on disk.
 *
 * Every .wem in this game is Wwise Vorbis (format tag 0xFFFF -- checked
 * across the export). No browser plays it and ffmpeg cannot decode it, so
 * vgmstream does the decode; ffmpeg (optional) re-encodes to Ogg, which is
 * ~5x smaller than WAV and plays everywhere.
 */
function convertWem(rel, full, format, cb) {
  const vgm = findVgmstream();
  if (!vgm) {
    return cb({
      status: 501,
      message: "No decoder installed",
      detail: "These files are Wwise Vorbis; browsers and ffmpeg can't decode them. Rebuild the Tools focus group (or install vgmstream) — raw .wem downloads work without it.",
    });
  }
  if (format === "ogg" && !canEncodeVorbis()) {
    // Never hand back a WAV labelled .ogg.
    return cb({
      status: 501,
      message: hasFfmpeg()
        ? "This ffmpeg build can't encode Ogg Vorbis (no libvorbis)."
        : "ffmpeg isn't installed, so Ogg can't be produced.",
      detail: "WAV downloads and in-browser playback work without it. To enable Ogg, rebuild the Tools focus group — it can install an ffmpeg with Vorbis support.",
    });
  }

  const key = crypto.createHash("sha1").update(rel).digest("hex");
  const cached = path.join(AUDIO_CACHE, `${key}.${format}`);
  if (fs.existsSync(cached)) return cb(null, cached);

  fs.mkdirSync(AUDIO_CACHE, { recursive: true });
  const wav = format === "wav" ? cached : path.join(AUDIO_CACHE, `${key}.tmp.wav`);

  const dec = spawn(vgm, ["-o", wav, full]);
  let derr = "";
  dec.stderr.on("data", (d) => { derr += d; });
  dec.on("error", (e) => cb({ message: `vgmstream failed to start: ${e.message}` }));
  dec.on("close", (code) => {
    if (code !== 0 || !fs.existsSync(wav)) {
      return cb({ message: `Decode failed: ${derr.slice(0, 300) || "vgmstream exit " + code}` });
    }
    if (format === "wav") return cb(null, cached);

    const enc = spawn(ffmpegPath(), ["-v", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", cached, "-y"]);
    enc.on("close", (c2) => {
      fs.rmSync(wav, { force: true });
      if (c2 !== 0 || !fs.existsSync(cached)) return cb({ message: "ffmpeg re-encode failed" });
      cb(null, cached);
    });
  });
}

app.get("/api/audio/preview", (req, res) => {
  const rel = req.query.path;
  const full = resolveWem(rel);
  if (!full) return res.status(404).json({ error: "No such .wem in the export." });

  // Prefer Ogg (small, seekable, universally supported); fall back to WAV
  // when ffmpeg isn't installed. Both are served with Accept-Ranges so the
  // browser can SEEK -- without range support an <audio> element can show
  // a duration but refuse to scrub.
  // Only prefer Ogg if this ffmpeg can genuinely produce one. Otherwise
  // WAV -- which every browser plays, and which vgmstream makes on its own.
  // Preferring a format we can't produce is what silently broke playback.
  const format = canEncodeVorbis() ? "ogg" : "wav";
  convertWem(rel, full, format, (err, file) => {
    if (err) return res.status(err.status || 500).json({ error: err.message, detail: err.detail });

    const stat = fs.statSync(file);
    const type = format === "ogg" ? "audio/ogg" : "audio/wav";
    const range = req.headers.range;
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", end - start + 1);
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------
// Tools rebuild
// ---------------------------------------------------------------
// WHY THE SERVER DOES THIS AND NOT THE PIPELINE:
// The Python pipeline LIVES in tools/. If you delete tools/, the pipeline
// is gone -- so it cannot possibly be the thing that rebuilds it. Node is
// still running, so Node does it.
//
// WHY IT EXISTS AT ALL:
// In a container, files copied in from the host arrive owned by the host's
// user and are effectively read-only to the app. Directories created by the
// RUNNING SERVER are owned by the server. So the app builds its own tools/
// rather than receiving one.
//
// builtin/ is the source of truth:
//   builtin/tools/        -- every script, vendored. Restored verbatim.
//   builtin/manifest.json -- external binaries to FETCH (vgmstream, ffmpeg),
//                            deliberately not vendored: third-party,
//                            separately licensed, and large.
const BUILTIN_DIR = path.join(PROJECT_ROOT, "builtin");
const TOOLS_DIR = path.join(PROJECT_ROOT, "tools");

const PYLIBS_DIR = path.join(PROJECT_ROOT, "tools", "pylibs");

/**
 * Environment for running our Python tools.
 *
 * In the container the app cannot write to the system site-packages, and
 * `pip install --break-system-packages` is refused outright -- so numpy and
 * Pillow simply were not installable, and the texture tools died with an
 * import error. Installing them with `pip install --target tools/pylibs`
 * needs no root and touches nothing outside the app's own directory; this
 * puts that directory on PYTHONPATH so the tools can find them.
 */
function pythonEnv() {
  const env = { ...process.env };
  if (fs.existsSync(PYLIBS_DIR)) {
    env.PYTHONPATH = env.PYTHONPATH ? `${PYLIBS_DIR}:${env.PYTHONPATH}` : PYLIBS_DIR;
  }
  return env;
}

function readManifest() {
  const p = path.join(BUILTIN_DIR, "manifest.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return null; }
}

/**
 * Texture endpoints.
 *
 * GET  /api/texture/resolve?path=/Game/...   -> where that texture lives on disk
 * GET  /api/texture/analyze?path=/Game/...   -> what each channel actually carries
 * POST /api/texture/normal-to-s              -> convert a normal map to a packed _S map
 */
function gamePathToLocal(gamePath) {
  if (!gamePath) return null;
  // "/Game/ROD/ITM/.../T_ITM_SH001003_S.0"  ->  Content/ROD/ITM/.../T_ITM_SH001003_S.png
  const clean = String(gamePath).replace(/\.\d+$/, "").replace(/^\/Game\//, "");
  const candidates = [
    path.join(PROJECT_ROOT, "Content", clean + ".png"),
    path.join(PROJECT_ROOT, "raw-export", "Content", clean + ".png"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

app.get("/api/texture/resolve", (req, res) => {
  const local = gamePathToLocal(req.query.path);
  if (!local) {
    // Being explicit beats a broken <img>: 18,396 textures / 17.6GB exist in
    // the game, and only the exported subset is on disk here.
    return res.json({ found: false, reason: "not exported yet" });
  }
  const rel = path.relative(PROJECT_ROOT, local).split(path.sep).join("/");
  const stat = fs.statSync(local);
  res.json({ found: true, url: "/" + rel, bytes: stat.size });
});

app.get("/api/texture/analyze", (req, res) => {
  const local = gamePathToLocal(req.query.path);
  if (!local) return res.status(404).json({ error: "Texture not exported." });
  const script = path.join(PROJECT_ROOT, "tools", "analyze_texture_maps.py");
  if (!fs.existsSync(script)) return res.status(500).json({ error: "tools/ is missing — run the Tools rebuild." });
  const r = spawnSync("python3", [script, local], { encoding: "utf-8", timeout: 60000, env: pythonEnv() });
  if (r.status !== 0) return res.status(500).json({ error: (r.stderr || "analysis failed").slice(0, 400) });
  res.json({ report: r.stdout });
});

app.post("/api/texture/normal-to-s", express.raw({ type: "*/*", limit: "64mb" }), (req, res) => {
  const script = path.join(PROJECT_ROOT, "tools", "normal_to_s.py");
  if (!fs.existsSync(script)) return res.status(500).json({ error: "tools/ is missing — run the Tools rebuild." });
  if (!req.body || !req.body.length) return res.status(400).json({ error: "No image uploaded." });

  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "tex-"));
  const inFile = path.join(tmp, "normal.png");
  const outFile = path.join(tmp, "packed_S.png");
  fs.writeFileSync(inFile, req.body);

  const args = [script, inFile, "-o", outFile];
  if (req.query.flipGreen === "true") args.push("--flip-green");
  if (req.query.blue === "curvature") args.push("--mask-from-curvature");
  else args.push("--mask-value", String(parseInt(req.query.blue, 10) || 255));

  const r = spawnSync("python3", args, { encoding: "utf-8", timeout: 120000, env: pythonEnv() });
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return res.status(500).json({ error: (r.stderr || "conversion failed").slice(0, 400) });
  }
  const png = fs.readFileSync(outFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Conversion-Log", Buffer.from(r.stdout || "").toString("base64"));
  res.send(png);
});

app.get("/api/tools/status", (req, res) => {
  const manifest = readManifest();
  const builtinTools = path.join(BUILTIN_DIR, "tools");
  const vendored = fs.existsSync(builtinTools)
    ? fs.readdirSync(builtinTools).filter((f) => !f.startsWith("."))
    : [];
  const present = fs.existsSync(TOOLS_DIR)
    ? fs.readdirSync(TOOLS_DIR).filter((f) => !f.startsWith(".") && f !== "__pycache__")
    : [];
  res.json({
    builtinPresent: fs.existsSync(builtinTools),
    toolsPresent: fs.existsSync(TOOLS_DIR),
    vendoredCount: vendored.length,
    restored: present.length,
    missing: vendored.filter((f) => !present.includes(f)),
    pythonPackages: ((manifest?.pythonPackages || {}).packages || []).map((pkg) => {
      const probe = spawnSync("python3", ["-c", `import ${pkg === "pillow" ? "PIL" : pkg}`],
        { encoding: "utf-8", env: pythonEnv() });
      return { name: pkg, installed: probe.status === 0 };
    }),
    externals: (manifest?.externalTools || []).map((t) => ({
      name: t.name,
      purpose: t.purpose,
      dest: t.dest,
      installed: fs.existsSync(path.join(PROJECT_ROOT, t.dest)),
      optional: Boolean(t.optional),
    })),
  });
});

app.post("/api/tools/rebuild", async (req, res) => {
  const log = [];
  const say = (m) => { log.push(m); console.log(`[tools] ${m}`); };

  const manifest = readManifest();
  if (!manifest) return res.status(500).json({ error: "builtin/manifest.json is missing — nothing to restore from." });

  const builtinTools = path.join(BUILTIN_DIR, "tools");
  if (!fs.existsSync(builtinTools)) return res.status(500).json({ error: "builtin/tools is missing — nothing to restore from." });

  // 1. Restore the vendored scripts. mkdir by THIS process, so the files end
  //    up owned by the user the app runs as -- the whole point in a container.
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  let restored = 0;
  for (const name of fs.readdirSync(builtinTools)) {
    const src = path.join(builtinTools, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(TOOLS_DIR, name);
    fs.copyFileSync(src, dst);
    if (name.endsWith(".sh")) fs.chmodSync(dst, 0o755);
    restored++;
  }
  say(`restored ${restored} script(s) from builtin/tools -> tools/`);

  // 2. Fetch the external binaries.
  const results = [];
  for (const tool of manifest.externalTools || []) {
    const dest = path.join(PROJECT_ROOT, tool.dest);
    if (fs.existsSync(dest)) {
      say(`${tool.name}: already present, skipped`);
      results.push({ name: tool.name, status: "already-present" });
      continue;
    }
    const url = (tool.platforms || {})[process.platform];
    if (!url) {
      say(`${tool.name}: no download for platform "${process.platform}" — skipped`);
      results.push({ name: tool.name, status: "unsupported-platform" });
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "rodtool-"));
      const dl_file = path.join(tmp, "download");

      say(`${tool.name}: downloading ${url}`);
      const dl = spawnSync("curl", ["-fsSL", "-o", dl_file, url], { encoding: "utf-8" });
      if (dl.status !== 0) throw new Error(`download failed: ${dl.stderr || dl.status}`);

      if (tool.directBinary) {
        // Some tools ship a bare binary rather than an archive (ffmpeg).
        fs.copyFileSync(dl_file, dest);
      } else {
        spawnSync("unzip", ["-o", "-q", dl_file, "-d", tmp]);
        // Find the binary rather than assuming a path: vgmstream has moved
        // things between releases before.
        const pattern = tool.archiveMember || `${tool.name}*`;
        const found = spawnSync("find", [tmp, "-type", "f", "-name", pattern], { encoding: "utf-8" });
        const bin = (found.stdout || "").split("\n").filter(Boolean)[0];
        if (!bin) throw new Error("no matching binary inside the archive");
        fs.copyFileSync(bin, dest);
      }
      fs.chmodSync(dest, 0o755);
      fs.rmSync(tmp, { recursive: true, force: true });
      say(`${tool.name}: installed -> ${tool.dest}`);
      results.push({ name: tool.name, status: "installed" });
    } catch (e) {
      // Optional tools must NOT fail the rebuild: a restricted container
      // network shouldn't cost you your scripts.
      say(`${tool.name}: FAILED — ${e.message}${tool.optional ? " (optional; the app still works without it)" : ""}`);
      results.push({ name: tool.name, status: "failed", error: e.message });
    }
  }

  // 3. Python packages the tools need (numpy, Pillow for the texture tools).
  //    --target keeps everything inside tools/pylibs: no root, no
  //    --break-system-packages, nothing outside the app's own directory.
  const py = manifest.pythonPackages;
  const pyResults = [];
  if (py && (py.packages || []).length) {
    const missing = [];
    for (const pkg of py.packages) {
      const probe = spawnSync("python3", ["-c", `import ${pkg === "pillow" ? "PIL" : pkg}`],
        { encoding: "utf-8", env: pythonEnv() });
      if (probe.status !== 0) missing.push(pkg);
    }
    if (!missing.length) {
      say(`python packages: all present (${py.packages.join(", ")})`);
      pyResults.push({ packages: py.packages, status: "already-present" });
    } else {
      // numpy/Pillow are an OPTIMISATION now, not a requirement: the texture
      // tools fall back to tools/pngkit.py (pure standard library) and work
      // without them. So try to install -- but a failure is a note, not an error.
      let ok = false;
      let inst = spawnSync("python3",
        ["-m", "pip", "install", "--target", PYLIBS_DIR, "--upgrade", ...missing],
        { encoding: "utf-8", timeout: 300000 });

      if (inst.status !== 0 && /No module named pip/i.test((inst.stderr || "") + (inst.stdout || ""))) {
        // The container may have no pip AT ALL. ensurepip ships with CPython
        // and can bootstrap one without root.
        say("python packages: no pip in this Python — trying ensurepip");
        const boot = spawnSync("python3", ["-m", "ensurepip", "--user"], { encoding: "utf-8", timeout: 120000 });
        if (boot.status === 0) {
          inst = spawnSync("python3",
            ["-m", "pip", "install", "--target", PYLIBS_DIR, "--upgrade", ...missing],
            { encoding: "utf-8", timeout: 300000 });
        }
      }

      ok = inst.status === 0;
      if (ok) {
        say(`python packages: installed -> ${py.target} (the texture tools will run at full speed)`);
        pyResults.push({ packages: missing, status: "installed" });
      } else {
        const err = ((inst.stderr || "") + (inst.stdout || "")).split("\n").filter(Boolean).slice(-1)[0] || "";
        say(`python packages: not installed (${err.slice(0, 80)}) — NOT a problem: the texture tools `
            + `fall back to pure standard library (tools/pngkit.py). They just run slower `
            + `(~9s for a 2048x2048 texture instead of ~1s).`);
        pyResults.push({ packages: missing, status: "using-stdlib-fallback", error: err.slice(0, 200) });
      }
    }
  }

  _vorbisCache = null;   // a freshly-installed ffmpeg changes what we can encode
  res.json({ ok: true, restored, externals: results, pythonPackages: pyResults, log,
    note: "tools/ was created by the server process, so it's owned by the app and writable." });
});

app.get("/api/pipeline/focus-groups", (req, res) => {
  // The Tools group is added HERE, by the server, and never comes from the
  // pipeline. That's the whole point: you delete tools/ (so the pipeline no
  // longer exists) and then click Tools to rebuild it. If this list were
  // sourced from the pipeline, the one button you need would vanish exactly
  // when you need it.
  const TOOLS_GROUP = {
    key: "tools",
    label: "Tools (rebuild tools/ from builtin/)",
    serverSide: true,
    endpoint: "/api/tools/rebuild",
    description: "Recreates tools/ from builtin/ and fetches external binaries (vgmstream). "
      + "Safe to run with tools/ deleted — the SERVER does this, not the pipeline, because the "
      + "pipeline lives in tools/. Directories are created by the running app, so they're owned "
      + "by it and writable inside a container.",
    sections: [],
  };

  const scriptPath = path.join(PROJECT_ROOT, "tools", "build_pipeline.py");
  if (!fs.existsSync(scriptPath)) {
    // tools/ has been deleted. That is a supported state, not an error --
    // return the one group that can fix it.
    return res.json({
      groups: {
        tools: {
          label: TOOLS_GROUP.label,
          sections: ["restore builtin/tools -> tools/", "fetch vgmstream"],
          autoIncluded: [],
          serverSide: true,
          endpoint: TOOLS_GROUP.endpoint,
        },
      },
      toolsMissing: true,
      note: "tools/ is missing, so the pipeline can't be queried. Run the Tools group to rebuild it.",
    });
  }

  const proc = spawn("python3", [scriptPath, "--focus-groups"],
    { cwd: path.join(PROJECT_ROOT, "tools") });
  let out = "", err = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { err += d; });
  proc.on("close", (code) => {
    if (code !== 0) {
      // Even a broken pipeline shouldn't hide the button that repairs it.
      return res.json({ focusGroups: [TOOLS_GROUP], toolsBroken: true,
        error: `focus-groups failed: ${err.slice(0, 300)}` });
    }
    try {
      const parsed = JSON.parse(out);
      // The dashboard reads `groups` (an object keyed by name), so the
      // Tools group has to be injected in THAT shape -- appending it to a
      // differently-named array would have shipped a button nobody sees.
      const groups = { ...(parsed.groups || {}) };
      groups.tools = {
        label: TOOLS_GROUP.label,
        sections: ["restore builtin/tools -> tools/", "fetch vgmstream"],
        autoIncluded: [],
        serverSide: true,
        endpoint: TOOLS_GROUP.endpoint,
      };
      res.json({ ...parsed, groups });
    } catch (e) {
      res.json({ groups: { tools: { label: TOOLS_GROUP.label, sections: [], serverSide: true, endpoint: TOOLS_GROUP.endpoint } },
        toolsBroken: true, error: `focus-groups returned unparseable output: ${e.message}` });
    }
  });
});

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
/**
 * Asset versioning, computed rather than hand-maintained.
 *
 * index.html used to carry a HARDCODED "?v=20260712" on all 46 script
 * and css tags. Every edit to a JS file after that stamp was written
 * shipped a file the browser had no reason to re-fetch -- which is
 * precisely how a freshly deployed feature (the GimmickDump preset)
 * can appear "missing" to the person running it. A number a human has
 * to remember to bump is a number that will be forgotten.
 *
 * So the stamp is now DERIVED: a short hash of every app asset's
 * mtime+size, computed at boot. Change any file, redeploy, and the URL
 * changes by itself. Nothing to remember.
 *
 * (This also fixed a dead duplicate: the static handler had TWO
 * setHeaders keys, so the first -- the html-specific one -- was
 * silently discarded by the object literal.)
 */
function computeAssetVersion() {
  const h = crypto.createHash("sha1");
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|css|lua)$/.test(e.name)) continue;
      const st = fs.statSync(full);
      h.update(`${full}:${st.mtimeMs}:${st.size}`);
    }
  };
  walk(path.join(PROJECT_ROOT, "app"));
  return h.digest("hex").slice(0, 12);
}
const ASSET_VERSION = computeAssetVersion();
console.log(`Asset version: ${ASSET_VERSION}`);

// Serve index.html with the computed stamp substituted in. Whatever ?v=
// value is written in the file is irrelevant -- this is the source of
// truth, so the two can never drift.
app.get(["/", "/index.html"], (req, res) => {
  let html;
  try { html = fs.readFileSync(path.join(PROJECT_ROOT, "index.html"), "utf-8"); }
  catch (e) { return res.status(500).send("index.html not found"); }
  html = html.replace(/\?v=[\w.-]+/g, `?v=${ASSET_VERSION}`);
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/api/asset-version", (req, res) => {
  res.json({ assetVersion: ASSET_VERSION, serverBuild: SERVER_BUILD });
});

app.use(
  express.static(__dirname, {
    setHeaders: (res, filePath) => {
      // HTML must always revalidate. Versioned assets (?v=<hash>) could
      // safely be cached hard, but no-cache keeps a bare reload honest
      // and costs little on a self-hosted LAN app.
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ROD Database Toolkit listening on http://0.0.0.0:${PORT}`);
});
