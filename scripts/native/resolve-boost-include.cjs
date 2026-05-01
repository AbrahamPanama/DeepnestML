#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const expectedBoostVersion = process.env.DEEPNEST_EXPECTED_BOOST_LIB_VERSION || "1_90";
const allowUnpinnedBoost = process.env.DEEPNEST_ALLOW_UNPINNED_BOOST === "1";

function toAbsolute(p) {
  if (!p) {
    return null;
  }
  return path.resolve(p);
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (err) {
    return false;
  }
}

function includeDirHasBoost(includeDir) {
  if (!includeDir) {
    return false;
  }

  const polygonHeader = path.join(includeDir, "boost", "polygon", "polygon.hpp");
  const versionHeader = path.join(includeDir, "boost", "version.hpp");
  return fileExists(polygonHeader) && fileExists(versionHeader);
}

function getBoostLibVersion(includeDir) {
  const versionHeader = path.join(includeDir, "boost", "version.hpp");
  const text = fs.readFileSync(versionHeader, "utf8");
  const match = text.match(/#define\s+BOOST_LIB_VERSION\s+"([^"]+)"/);
  return match ? match[1] : null;
}

function collectCandidateDirs() {
  const candidates = [];

  function push(dir) {
    const abs = toAbsolute(dir);
    if (abs) {
      candidates.push(abs);
    }
  }

  push(process.env.BOOST_INCLUDEDIR);
  if (process.env.BOOST_ROOT) {
    push(path.join(process.env.BOOST_ROOT, "include"));
    push(process.env.BOOST_ROOT);
  }

  push(path.join(repoRoot, "third_party", "boost_1_90_0"));
  push(path.join(repoRoot, "third_party", "boost"));
  push("/opt/homebrew/opt/boost/include");
  push("/usr/local/opt/boost/include");
  push("/opt/homebrew/include");
  push("/usr/local/include");

  return [...new Set(candidates)];
}

function fail(message, candidates) {
  const lines = [];
  lines.push(message);
  if (candidates && candidates.length > 0) {
    lines.push("Checked include candidates:");
    candidates.forEach((candidate) => lines.push(`- ${candidate}`));
  }
  lines.push("Set BOOST_INCLUDEDIR or BOOST_ROOT to a directory containing boost/polygon/polygon.hpp.");
  lines.push("To bypass version pinning temporarily, set DEEPNEST_ALLOW_UNPINNED_BOOST=1.");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

const candidates = collectCandidateDirs();
const resolvedIncludeDir = candidates.find(includeDirHasBoost);

if (!resolvedIncludeDir) {
  fail(`Unable to locate Boost headers required for native addon build (expected ${expectedBoostVersion}).`, candidates);
}

const resolvedBoostVersion = getBoostLibVersion(resolvedIncludeDir);
if (!resolvedBoostVersion) {
  fail(`Unable to parse BOOST_LIB_VERSION in ${resolvedIncludeDir}/boost/version.hpp.`, candidates);
}

if (!allowUnpinnedBoost && expectedBoostVersion && resolvedBoostVersion !== expectedBoostVersion) {
  fail(
    `Boost version mismatch: found ${resolvedBoostVersion} at ${resolvedIncludeDir}, expected ${expectedBoostVersion}.`,
    candidates
  );
}

process.stdout.write(`${resolvedIncludeDir}\n`);
