#!/usr/bin/env node
/**
 * Download the sources generate.mjs reads into core/.sources/ (git-ignored).
 * Requires curl, unzip and tar on PATH.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? path.join(here, "..", ".sources"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
fs.mkdirSync(OUT, { recursive: true });

const SOURCES = {
  hapiStructures: "https://repo1.maven.org/maven2/ca/uhn/hapi/hapi-structures-v251/2.5.1/hapi-structures-v251-2.5.1-sources.jar",
  hapiStructuresJar: "https://repo1.maven.org/maven2/ca/uhn/hapi/hapi-structures-v251/2.5.1/hapi-structures-v251-2.5.1.jar",
  hapiBase: "https://repo1.maven.org/maven2/ca/uhn/hapi/hapi-base/2.5.1/hapi-base-2.5.1-sources.jar",
  tho: "https://packages.fhir.org/hl7.terminology.r4/7.4.0",
  stu3Core: "https://packages.fhir.org/hl7.fhir.r3.core/3.0.2",
  stu3TablePage: "https://hl7.org/fhir/STU3/v2/{table}/index.html",
};

const dl = (url, file) => {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) run("curl", ["-sSL", "--fail", "-m", "300", "-o", file, url]);
};
dl(SOURCES.hapiStructures, path.join(OUT, "hapi-structures-v251-2.5.1-sources.jar"));
dl(SOURCES.hapiStructuresJar, path.join(OUT, "hapi-structures-v251-2.5.1.jar"));
dl(SOURCES.hapiBase, path.join(OUT, "hapi-base-2.5.1-sources.jar"));
dl(SOURCES.tho, path.join(OUT, "tho.tgz"));
dl(SOURCES.stu3Core, path.join(OUT, "stu3-core.tgz"));

fs.mkdirSync(path.join(OUT, "hapi"), { recursive: true });
fs.mkdirSync(path.join(OUT, "hapi-base"), { recursive: true });
run("unzip", ["-q", "-o", path.join(OUT, "hapi-structures-v251-2.5.1-sources.jar"), "ca/uhn/hl7v2/model/v251/*", "-d", path.join(OUT, "hapi")]);
run("unzip", ["-q", "-o", path.join(OUT, "hapi-base-2.5.1-sources.jar"), "ca/uhn/hl7v2/model/v251/datatype/*", "-d", path.join(OUT, "hapi-base")]);
fs.writeFileSync(
  path.join(OUT, "hapi/eventmap-2.5.1.properties"),
  execFileSync("unzip", ["-p", path.join(OUT, "hapi-structures-v251-2.5.1.jar"), "ca/uhn/hl7v2/parser/eventmap/2.5.1.properties"])
);
for (const [tgz, dir] of [["tho.tgz", "tho"], ["stu3-core.tgz", "stu3-core"]]) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  run("tar", ["xzf", path.join(OUT, tgz), "-C", path.join(OUT, dir)]);
}

const stu3Dir = path.join(OUT, "stu3-v2");
fs.mkdirSync(stu3Dir, { recursive: true });
// The STU3 package does not list every table page that STU3 publishes, so try
// every table THO knows about as well. A 404 simply means STU3 has no page.
const tables = [
  ...new Set([
    ...fs
      .readdirSync(path.join(OUT, "stu3-core/package"))
      .map((f) => /^CodeSystem-v2-(\d{4})\.json$/.exec(f)?.[1])
      .filter(Boolean),
    ...JSON.parse(fs.readFileSync(path.join(OUT, "tho/package/CodeSystem-v2-tables.json"), "utf8"))
      .concept.map((c) => c.code)
      .filter((c) => /^\d{4}$/.test(c)),
  ]),
].sort();
const missing = path.join(stu3Dir, "404.txt");
const known404 = new Set(fs.existsSync(missing) ? fs.readFileSync(missing, "utf8").split("\n").filter(Boolean) : []);
for (const t of tables) {
  const file = path.join(stu3Dir, `${t}.html`);
  if ((fs.existsSync(file) && fs.statSync(file).size > 0) || known404.has(t)) continue;
  try {
    run("curl", ["-sS", "--fail", "-m", "60", "-o", file, SOURCES.stu3TablePage.replace("{table}", t)], { stdio: "ignore" });
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    known404.add(t);
  }
}
fs.writeFileSync(missing, [...known404].sort().join("\n") + "\n");

fs.writeFileSync(
  path.join(OUT, "sources.json"),
  JSON.stringify(
    {
      hapi: { artifact: "ca.uhn.hapi:hapi-structures-v251:2.5.1 (+ hapi-base:2.5.1 primitives)", licence: "MPL-1.1 OR GPL (dual)", url: SOURCES.hapiStructures },
      tho: { package: "hl7.terminology.r4#7.4.0", licence: "CC0-1.0", url: SOURCES.tho },
      stu3: { package: "hl7.fhir.r3.core#3.0.2 v2 table pages (Version column)", licence: "CC0-1.0 (FHIR licence)", url: "https://hl7.org/fhir/STU3/v2/", tables: fs.readdirSync(stu3Dir).filter((f) => f.endsWith(".html")).length },
      fetched: new Date().toISOString(),
    },
    null,
    1
  )
);
console.log(`Sources ready in ${OUT}`);
