# Windows Port Plan — Deepnest ML

Status: PLAN — not started. Author: Claude-Code, 2026-06-12.

Audience: an implementing agent/human with no prior context. The goal is a working
**Windows x64 build of Deepnest ML that preserves every shipped feature**, built and
verified on a Windows machine. macOS builds must keep working unchanged (this is additive
cross-platform support, not a migration).

Reality up front: the app is **Electron 40.9.3 + a Node-N-API/NAN native addon (Boost.Polygon,
header-only) + a Python sidecar (PyMuPDF + Pillow) for raster/vector conversion**. The
JavaScript app layer is already platform-neutral. Three things carry real Windows risk: the
**native addon toolchain (MSVC + Boost headers)**, the **Python sidecar availability**, and
**packaging/signing**. Everything else is small platform-branch hygiene.

A Windows build host is required for the native and packaging work — electron-builder does not
cross-compile the C++ addon or produce a signed NSIS installer from macOS. This Mac session can
write code, fix cross-platform logic, and prepare config, but the build/verify steps in
WP-W1/W4 must run on Windows.

---

## 0. Ground rules

1. **Multi-agent protocol.** Read `AGENTS.md` then `AGENT_COLLABORATION.md`; claim WPs
   (`WIN-W1`…`WIN-W5`); leave Handoff Notes; prefix commits `[<agent>] WIN-Wx: <summary>`.
2. **macOS must not regress.** Every `package.json`/`binding.gyp`/`main.js` change must be
   guarded so the existing mac build, the native addon, and the conversion service behave
   identically on darwin. Re-run the mac smoke battery after any shared-file edit.
3. **Not ML-sensitive in behavior**, but `main.js` is on the ML-sensitive list — these edits
   are platform plumbing only (no nesting/geometry/teacher logic), so no ML checkpoint is
   needed as long as you touch only the platform branches named here.
4. **Branch from a known-good commit.** The working tree currently carries large uncommitted
   feature work (SOTA/LR/TIFF). Do the Windows port on its own branch off a clean checkpoint
   so a Windows build failure never entangles that work.

---

## 1. Current macOS-specific inventory (verified 2026-06-12)

Already cross-platform (leave alone, just confirm):
- **Native addon load paths** — `main.js:loadNativeAddon` (~`:44`) uses `path.join` and an
  asar→asar.unpacked rewrite with a `[\\/]` separator class, so it already resolves on Windows.
- **Boost resolver** — `scripts/native/resolve-boost-include.cjs` checks `BOOST_INCLUDEDIR`,
  `BOOST_ROOT`, and `third_party/boost*` before the Mac-only Homebrew fallbacks. Boost.Polygon
  is **header-only** (no compiled Boost libs to link) — a major simplification.
- **electron-builder** already has a `win` block with `icon.ico`, and `icon.ico` is in `files`
  (`package.json:70-101`).
- **Window chrome** — `main.js:136` sets `frameless = process.platform === 'darwin'`, so Windows
  already gets a normal framed window.
- **Conversion server** for DXF import/export is a remote HTTP POST to
  `http://convert.deepnest.io` (`main/index.html:443,2617`) — network, platform-neutral.
- The app **runtime requires none of the `ml/scripts/*.sh`** — those are dev/CI tooling only.

macOS-specific, must change for Windows:
- **A. Native build scripts** (`package.json:15-18`) use POSIX shell `$(node -p "...")`
  command substitution — fails under cmd/PowerShell. `build:arm64` is Mac-only.
- **B. C++ exception flags** in `binding.gyp` are set only for `OS=="mac"`
  (`GCC_ENABLE_CPP_EXCEPTIONS`). MSVC needs `ExceptionHandling` / `/EHsc`. Boost.Polygon +
  `minkowski.cc` use exceptions and require C++11+ (MSVC default is fine; pin a standard).
- **C. Python resolution** (`main.js:getPythonCandidates`, ~`:726`) lists only `python3` and
  Mac absolute paths, plus a darwin-gated `/usr/bin/arch -arm64` wrapper. Windows interpreters
  are `python`, `py -3` — not present.
- **D. Python availability**: the conversion sidecar (PDF export, PNG/PDF import, and the
  planned TIFF export) needs Python + PyMuPDF + Pillow. macOS usually has a system Python;
  Windows usually does not. This is the single biggest porting decision (WP-W2).
- **E. Packaging target**: `mac.target = dmg`; there is no `win.target` (no NSIS/portable),
  no Windows code-signing.
- **F. Dev tooling**: 7 `ml/scripts/*.sh` (smoke, boot-check, legacy runtime) are bash +
  `arch -x86_64`. Not shipped; needed only if Windows CI runs the smoke battery (WP-W5,
  optional).

---

## 2. Strategy decisions (locked)

1. **Target**: Windows 10/11 **x64** first. (arm64-Windows is a later, optional follow-up; the
   toolchain differs and demand is low.)
2. **Build host**: a Windows machine with **Visual Studio 2022 Build Tools** (MSVC v143 +
   "Desktop development with C++" + Windows 10/11 SDK) and **Node 20 LTS**. node-gyp also needs
   a Python for its own build scripts (3.x). Document this as the build prerequisite.
3. **Boost**: vendor headers at `third_party/boost_1_90_0/` (matching the pinned
   `DEEPNEST_EXPECTED_BOOST_LIB_VERSION=1_90`) OR set `BOOST_ROOT`. Header-only — no Boost
   compilation. Pinning stays enforced.
4. **Python sidecar**: **bundle an embeddable Python with the conversion wheels** (WP-W2,
   Option A) so end users need nothing installed. This is required to "preserve most features"
   — PDF export and PNG/PDF/TIFF conversion are otherwise dead on a clean Windows box. A
   detect-system-Python fallback (Option B) stays as a secondary path for power users.
5. **Cross-platform build scripts**: replace the shell-substitution npm scripts with a small
   Node build driver (`scripts/native/build-addon.cjs`) that computes the electron version/arch
   and invokes node-gyp identically on every OS.
6. **Packaging**: `win.target = ["nsis", "portable"]`. Ship **unsigned** in v1 (document the
   SmartScreen warning + how to add Authenticode later). Mac packaging untouched.

---

## 3. WP-W1 — Native addon builds on Windows (MSVC + Boost)

### 3.1 binding.gyp — add an MSVC branch
In the `conditions` array (currently only `OS=="mac"`), add:
```
['OS=="win"', {
  'msvs_settings': {
    'VCCLCompilerTool': {
      'ExceptionHandling': 1,          // /EHsc
      'AdditionalOptions': ['/std:c++17', '/bigobj']
    }
  },
  'defines': ['NOMINMAX', '_HAS_EXCEPTIONS=1']
}]
```
- `NOMINMAX` is mandatory — Windows headers define `min`/`max` macros that collide with
  Boost.Polygon and `std::numeric_limits`. Without it the build fails with cryptic template
  errors.
- `/bigobj` guards against Boost.Polygon's large template object files.
- Keep the existing `cflags!`/`cflags_cc!` no-ops (ignored by MSVC).

### 3.2 Cross-platform build scripts (`package.json`)
Create `scripts/native/build-addon.cjs`:
```
// resolves electron version + target arch, runs node-gyp rebuild on any OS
const cp = require('child_process');
const electronVersion = require('electron/package.json').version;
const arch = process.env.DEEPNEST_BUILD_ARCH || process.arch;   // 'x64' on win
const args = ['-y','node-gyp@12','rebuild',
  '--target='+electronVersion, '--arch='+arch,
  '--dist-url=https://electronjs.org/headers'];
cp.spawnSync('npx', args, {stdio:'inherit', shell: process.platform==='win32'});
process.exit(...) // propagate code
```
Replace the `build`/`build:arm64` scripts with:
```
"configure": "node scripts/native/build-addon.cjs --configure",
"build":     "node scripts/native/build-addon.cjs",
"build:arm64": "...keep for mac (DEEPNEST_BUILD_ARCH=arm64) ..."
```
(Keep `build:arm64` for the mac path; it just sets the env var.) The Node driver removes the
bash `$(...)` substitution that breaks on Windows.

### 3.3 Boost provisioning on the build host
Document two supported routes (the resolver already accepts both):
- vendor `third_party/boost_1_90_0/boost/...` (headers only; ~200MB, gitignore it), or
- install Boost 1.90 and set `BOOST_ROOT=C:\local\boost_1_90_0`.
If a different Boost is unavoidable, `DEEPNEST_ALLOW_UNPINNED_BOOST=1` bypasses the version
check (note the NFP-output risk if Boost.Polygon behavior differs — prefer 1_90).

### 3.4 Gate (on Windows)
- `npm run build` produces `build/Release/addon.node` as a PE/COFF x64 DLL.
- `set ELECTRON_RUN_AS_NODE=1 && "node_modules/.bin/electron" ml/tests/nfp_equivalence/run.js`
  passes all fixtures (native NFP == JS NFP) — this is the proof the C++ port is correct, not
  just compiling. The equivalence harness is the single most important Windows gate.

---

## 4. WP-W2 — Python sidecar on Windows (the feature-preservation crux)

The conversion service (`main.js:runLocalConversion`, `:822`) shells out to Python for:
PDF export (`svg-to-pdf`), PNG/JPG import (`*-to-svg`), PDF import (`pdf-to-svg`), and the
planned TIFF export. Without Python+PyMuPDF+Pillow on Windows, those features silently fail.

### 4.1 Option A (ship this): bundled embeddable Python
- Vendor a **Windows embeddable CPython** (e.g. 3.11 x64) under `python/win/` and `pip install
  --target` the wheels (`pymupdf pillow numpy scipy contourpy`) into it. All are pure-wheel or
  have Windows wheels — no compilation on the user's machine.
- Add `python/win/**` to electron-builder `files` and to `asarUnpack` (it must execute from
  disk, not from inside the asar).
- Resolution: in `getPythonCandidates`, prepend the bundled interpreter when on Windows:
  `path.join(process.resourcesPath || __dirname, 'app.asar.unpacked','python','win','python.exe')`
  and the dev path `path.join(__dirname,'python','win','python.exe')`.
- Size cost ~150–250MB unpacked; acceptable for a desktop CAD-class app. Keep mac on system
  Python (no bundled python on darwin) to avoid bloating the dmg.

### 4.2 getPythonCandidates — Windows interpreters
Add, after the env-var entries and before the Mac paths, when `process.platform==='win32'`:
- the bundled interpreter path(s) above (highest priority),
- `'python'`, `'python.exe'`,
- the launcher as `{command:'py', argsPrefix:['-3']}` (note: `py -3` needs the argsPrefix
  mechanism the function already supports).
Keep the darwin `arch -arm64` block gated as-is. The doctor (`run_doctor`) already reports
per-mode readiness, so a missing wheel surfaces as a clear health error, not a crash.

### 4.3 Conversion-service path hygiene
`runLocalConversion` uses `os.tmpdir()` + `path.join` (cross-platform) and `execFileAsync`
(no shell) — good. Verify the temp file extension logic and that `execFile` finds `python.exe`
(it will, given an absolute bundled path; for `py`/`python` it relies on PATH). No code change
expected beyond the candidate list, but confirm on Windows.

### 4.4 Gate (on Windows)
- `<bundled python> scripts/conversion/local-convert.py --mode doctor` → all modes `true`.
- In-app: import a PNG (→ contour), import a PDF, export a PDF — each must succeed. These
  exercise `png-to-svg`, `pdf-to-svg`, `svg-to-pdf` end-to-end through the bundled Python.

---

## 5. WP-W3 — App runtime platform branches

Small, mac-safe edits in `main.js` (+ a couple of UI confirmations):
1. **Python candidates** — §4.2 (the main change).
2. **Window chrome** — already correct (`frameless` darwin-only). Confirm the custom
   titlebar/traffic-light UI in `main/index.html` (if any) is hidden on Windows; if there is a
   mac-only close/min/max overlay, gate it behind a platform flag exposed to the renderer
   (e.g. `process.platform`). Verify the menu/accelerators (Cmd vs Ctrl) — Electron maps
   `CmdOrCtrl` automatically if used; audit for hardcoded `Cmd`.
3. **DXF conversion server** — unchanged (network). Confirm `request` (old dependency) works on
   Windows; it does, but note it's deprecated.
4. **Single-instance / userData paths** — Electron handles `app.getPath('userData')`
   cross-platform; the NFP disk cache (`main.js`) already uses it. Confirm no hardcoded `/tmp`
   or `~` anywhere (grep `'/tmp'`, `'/Users'`, `process.env.HOME`).

### Gate
`node --check main.js`; launch on Windows (`npm start`) → main window + hidden background
workers boot with no console errors; run a small SVG nest to completion.

---

## 6. WP-W4 — electron-builder Windows packaging

`package.json` build block:
```
"win": {
  "icon": "icon.ico",
  "target": ["nsis", "portable"]
},
"nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true }
```
- Ensure `build/Release/**` and `python/win/**` are in `files` + `asarUnpack` (the native
  `.node` and the Python tree must be on disk, not in the asar).
- `artifactName` already templates `${os}-${arch}` → produces
  `Deepnest ML-<v>-win-x64.exe`.
- **Signing**: ship unsigned for v1; document that users will see SmartScreen "unknown
  publisher" and how to proceed, plus where an Authenticode cert/`win.certificateFile` would
  slot in later.
- Build on Windows: `npm ci` → `npm run build` (addon) → `npx electron-builder --win`.

### Gate
Install the NSIS output on a clean Windows 10/11 VM (no Python, no VS) → app launches, native
NFP works (nest a job), PDF export works (bundled Python), TIFF export works once that feature
lands. This clean-VM test is the real "preserve features" proof.

---

## 7. WP-W5 — Dev/CI tooling parity (optional, do last)

The 7 `ml/scripts/*.sh` are bash + `arch`. Not needed to ship. If Windows CI should run the
smoke battery/boot-check:
- Port `run_boot_check.sh` and `run_smoke_battery.sh` to a **Node runner**
  (`ml/cli/run_smoke.js`) that invokes the same `ml/app-smoke-main.js` with the platform's
  Electron binary — Node is already a dependency and avoids maintaining parallel `.ps1`/`.sh`.
- The legacy x64 teacher/runtime scripts are macOS-Rosetta-specific; leave them mac-only and
  document that the ML teacher pipeline currently runs on macOS only (acceptable — it is
  developer tooling, not a shipped feature).

---

## 8. Feature-preservation verification matrix (run on a clean Windows VM)

| Feature | Depends on | Windows risk | Verify |
|---|---|---|---|
| SVG import / nest / SVG export | pure JS | none | nest a multi-part SVG, export SVG |
| Native NFP (Boost addon) | MSVC build | **high** | nfp_equivalence harness passes |
| Minkowski utility process | Electron | low | a nest that exercises native NFP completes |
| PDF export | Python+PyMuPDF | **high** | export PDF, opens valid |
| PNG contour import | Python+Pillow+scipy | **high** | import transparent PNG → contour |
| PDF composite import | Python+PyMuPDF | high | import sticker PDF |
| DXF import/export | remote server | low | round-trip a DXF |
| Step & Repeat | pure JS | none | run a step-repeat job |
| Sheet margin / export sheet outline | pure JS | none | toggle + export |
| Local refinement engines | pure JS | none | enable, run |
| NFP disk cache + clear | Node fs/userData | low | clear cache, re-nest |
| TIFF export (when landed) | Python+Pillow | high | per-sheet TIFFs + ICC |

"Preserve most features" = the entire **high-risk column passes on a clean VM**. The JS/pure
column is essentially free.

---

## 9. Risks / traps

1. **`NOMINMAX` omission** is the classic Windows-Boost build failure — set it (3.1).
2. **ABI mismatch**: the addon must be built against the exact Electron version's headers
   (`--target=40.9.3 --dist-url=electron headers`). A Node-ABI build will load-fail at runtime
   with a confusing "not a valid Win32 application"/module-version error. The build driver
   (3.2) pins this.
3. **Bundled Python wheels arch**: must be win-x64 wheels matching the embeddable Python's
   version; a mismatched PyMuPDF wheel imports but crashes. Pin Python 3.11 + known wheel
   versions; verify via the doctor on the build host AND the clean VM.
4. **asar vs disk**: the `.node` addon and `python/win` MUST be in `asarUnpack`, or
   `require`/`execFile` against an asar-virtual path fails. The load-path code already searches
   `app.asar.unpacked`; the packaging must actually put them there.
5. **Path separators in any NEW code**: always `path.join`; never hardcode `/`. Audit before
   shipping.
6. **`request` (DXF) is deprecated** and may have TLS quirks on Windows; if it misbehaves,
   swap to `https`/`fetch` — but only if it actually fails (don't pre-emptively churn).
7. **SmartScreen** on the unsigned installer will alarm users; document it and plan signing as
   a fast-follow.
8. **Long-path / OneDrive-redirected userData**: Electron `getPath('userData')` handles this,
   but the NFP cache writing thousands of small files can be slow on OneDrive-synced profiles —
   note for support, not a blocker.

---

## 10. Work-package order & claims

| Order | WP | Claim | Where it runs | Gate |
|---|---|---|---|---|
| 1 | WIN-W1 | `WIN-W1 native addon MSVC + cross-platform build scripts` | Windows host | nfp_equivalence passes (§3.4) |
| 2 | WIN-W2 | `WIN-W2 bundled Python sidecar` | Windows host | converter doctor all-true; PDF/PNG import+export (§4.4) |
| 3 | WIN-W3 | `WIN-W3 runtime platform branches` | Mac-authorable, Windows-verified | app launches + nests on Windows (§5) |
| 4 | WIN-W4 | `WIN-W4 electron-builder NSIS/portable` | Windows host | clean-VM install passes the §8 matrix |
| 5 | WIN-W5 | `WIN-W5 dev/CI tooling parity (optional)` | any | node smoke runner green on Windows |

W3 (and the binding.gyp/package.json edits of W1) can be authored from this Mac session and
must be verified to not regress the mac build (re-run the mac smoke battery + a mac
`npm run build`). W1's compile, W2's bundling, and W4's packaging require the Windows host.
Sequence W1→W2→W3→W4; W5 is optional and last.
