#!/usr/bin/env node
/**
 * Generate the HL7 v2.5.1 reference data in core/data/ from real sources.
 * Nothing here is invented: every record says where it came from.
 *
 *   Structure (segments, fields, datatypes, message structures, event map):
 *     HAPI HL7v2 hapi-structures-v251 2.5.1 + hapi-base 2.5.1 sources
 *     (Maven Central, ca.uhn.hapi). Dual-licensed MPL 1.1 / GPL. Only facts
 *     (names, types, lengths, optionality, repeats, table bindings, group
 *     layout) are extracted; no HAPI code is copied.
 *   Table values and table metadata:
 *     HL7 Terminology (THO) hl7.terminology.r4 7.4.0, CC0 1.0.
 *   Per-code v2 version history (what proves a code is valid in v2.5.1):
 *     FHIR STU3 (3.0.2) v2 table pages, hl7.org/fhir/STU3/v2/<table>/,
 *     "Version" column (e.g. "added v2.3", "from v2.1, removed after v2.5.1").
 *     FHIR is published under CC0 (hl7.org/fhir/STU3/license.html).
 *   Hand-written notes (descriptions, pitfalls, C/B/W optionality):
 *     data/overlay/*.json — the curated content from the original server.
 *   Sourced corrections: data/overrides.json (each with its evidence).
 *
 * Usage: node scripts/fetch-sources.mjs && node scripts/generate.mjs [sourcesDir]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(here, "..");
const SRC = path.resolve(process.argv[2] ?? path.join(CORE, ".sources"));
const DATA = path.join(CORE, "data");
const HAPI = path.join(SRC, "hapi/ca/uhn/hl7v2/model/v251");
const HAPI_BASE = path.join(SRC, "hapi-base/ca/uhn/hl7v2/model/v251/datatype");
const EVENTMAP = path.join(SRC, "hapi/eventmap-2.5.1.properties");
const THO = path.join(SRC, "tho/package");
const STU3 = path.join(SRC, "stu3-v2");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const overlay = {
  segments: readJson(path.join(DATA, "overlay/segments.json")),
  messages: readJson(path.join(DATA, "overlay/messages.json")),
  tables: readJson(path.join(DATA, "overlay/tables.json")),
};
const overrides = readJson(path.join(DATA, "overrides.json"));
const javaFiles = (dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".java")).map((f) => [f.slice(0, -5), fs.readFileSync(path.join(dir, f), "utf8")]);
const vnum = (v) => {
  const p = String(v).split(".").map(Number);
  return (p[0] || 0) * 10000 + (p[1] || 0) * 100 + (p[2] || 0);
};
const V251 = vnum("2.5.1");

// ─── STU3 per-code version history ──────────────────────────────────────────
function decodeEntities(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&")
    .trim();
}
function readStu3(table) {
  const f = path.join(STU3, `${table}.html`);
  if (!fs.existsSync(f)) return null;
  const html = fs.readFileSync(f, "utf8");
  const start = html.indexOf('<table class="grid"><tr><td><b>Code</b>');
  if (start < 0) return { rows: new Map() };
  const end = html.indexOf("</table>", start);
  const rowsHtml = html.slice(start, end).split(/<tr>/).slice(2);
  const header = html.slice(start, html.indexOf("</tr>", start)).match(/<b>([^<]*)<\/b>/g).map((h) => h.replace(/<\/?b>/g, ""));
  const iCode = header.indexOf("Code");
  const iDesc = header.indexOf("Description");
  const iComment = header.indexOf("Comment");
  const iVersion = header.indexOf("Version");
  const rows = new Map();
  for (const r of rowsHtml) {
    const cells = [...r.matchAll(/<td(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/td>)/g)].map((m) => decodeEntities(m[1] ?? ""));
    if (!cells.length) continue;
    const code = cells[iCode];
    if (!code) continue;
    rows.set(code, {
      display: cells[iDesc] ?? "",
      comment: iComment >= 0 ? cells[iComment] ?? "" : "",
      version: iVersion >= 0 ? cells[iVersion] ?? "" : "",
    });
  }
  return { rows };
}
/** Classify a STU3 version string for v2.5.1. */
function classify(version) {
  const v = String(version || "");
  const added = /(?:from|added) v([\d.]+)/.exec(v);
  const removed = /removed after v([\d.]+)/.exec(v);
  if (!added) return { status: "unverified", reason: v ? `Unrecognised version note '${v}'.` : "No version history in the source." };
  if (vnum(added[1]) > V251) return { status: "not-in-2.5.1", reason: `Added in v${added[1]}.` };
  if (removed && vnum(removed[1]) < V251) return { status: "not-in-2.5.1", reason: `Removed after v${removed[1]}.` };
  return { status: "valid", reason: v };
}

// ─── THO tables ─────────────────────────────────────────────────────────────
const thoTables = readJson(path.join(THO, "CodeSystem-v2-tables.json"));
const thoMeta = new Map(
  thoTables.concept.map((c) => [
    c.code,
    {
      name: c.display,
      definition: c.definition,
      props: Object.fromEntries((c.property || []).map((p) => [p.code, p.valueString ?? p.valueCode ?? p.valueInteger])),
    },
  ])
);
function thoCodes(table) {
  const f = path.join(THO, `CodeSystem-v2-${table}.json`);
  if (!fs.existsSync(f)) return null;
  const cs = readJson(f);
  const out = [];
  const walk = (list) =>
    (list || []).forEach((c) => {
      const prop = Object.fromEntries((c.property || []).map((p) => [p.code, p.valueCode ?? p.valueString ?? p.valueBoolean]));
      out.push({ code: c.code, display: c.display, definition: c.definition, deprecatedIn: prop["v2-table-deprecated"] ?? null, thoStatus: prop.status ?? null });
      walk(c.concept);
    });
  walk(cs.concept);
  return { url: cs.url, version: cs.version, codes: out };
}

// ─── HAPI segments ──────────────────────────────────────────────────────────
const FIELD_RE =
  /this\.add\((\w+)\.class,\s*(true|false),\s*(-?\d+),\s*(\d+),\s*new Object\[\]\{\s*getMessage\(\)(?:,\s*new Integer\((\d+)\))?\s*\},\s*"((?:[^"\\]|\\.)*)"\)/g;
const HAPI_ONLY_SEGMENTS = new Set(["Hxx", "ZL7", "CON_"]); // HAPI placeholders with no fields
const hapiSegments = {};
for (const [cls, src] of javaFiles(path.join(HAPI, "segment"))) {
  if (HAPI_ONLY_SEGMENTS.has(cls)) continue;
  const m = /Represents an HL7 (\S+) message segment \(([^)]*)\)/.exec(src);
  const fields = [];
  let f;
  let seq = 0;
  FIELD_RE.lastIndex = 0;
  while ((f = FIELD_RE.exec(src))) {
    seq++;
    fields.push({ seq, name: f[6].replace(/\\"/g, '"'), type: f[1], req: f[2] === "true", maxReps: +f[3], len: +f[4], table: f[5] ? f[5].padStart(4, "0") : null });
  }
  hapiSegments[m ? m[1] : cls] = { name: m ? m[2] : cls, fields };
}

// ─── HAPI datatypes ─────────────────────────────────────────────────────────
const hapiDatatypes = {};
for (const [cls, src] of javaFiles(path.join(HAPI, "datatype"))) {
  const m = /Represents an HL7 (\S+) \(([^)]*)\) data type/.exec(src);
  const comps = [];
  const re = /data\[(\d+)\] = new (\w+)\(getMessage\(\)(?:,\s*(?:new Integer\()?(\d+)\)?)?\)/g;
  let c;
  while ((c = re.exec(src))) comps[+c[1]] = { seq: +c[1] + 1, type: c[2], table: c[3] ? c[3].padStart(4, "0") : null };
  const nre = /Returns (.+?) \(component (\d+)\)/g;
  let n;
  while ((n = nre.exec(src))) {
    const i = +n[2] - 1;
    if (comps[i] && !comps[i].name) comps[i].name = n[1];
  }
  hapiDatatypes[m ? m[1] : cls] = { name: m ? m[2] : null, components: comps.filter(Boolean) };
}
for (const prim of ["DT", "DTM", "ID", "IS", "TM"]) {
  if (fs.existsSync(path.join(HAPI_BASE, `${prim}.java`)) && !hapiDatatypes[prim]) hapiDatatypes[prim] = { name: null, components: [] };
}

// ─── HAPI message structures ────────────────────────────────────────────────
const hapiGroups = Object.fromEntries(javaFiles(path.join(HAPI, "group")));
function expand(src) {
  const items = [];
  const re = /this\.add\((\w+)\.class,\s*(true|false),\s*(true|false)(?:,\s*(true|false))?\)/g;
  let a;
  const raw = [];
  while ((a = re.exec(src))) {
    const [, cls, req, rpt, choice] = a;
    const item = hapiGroups[cls]
      ? { group: cls.replace(/^[A-Z]{3}_[A-Za-z0-9]{3}_/, ""), required: req === "true", repeating: rpt === "true", children: expand(hapiGroups[cls]) }
      : { segment: cls.replace(/_$/, ""), required: req === "true", repeating: rpt === "true" };
    raw.push([item, choice === "true"]);
  }
  // HAPI marks the members of a choice (e.g. <OBR|RQD|RQ1|RXO|ODS|ODT>) with a
  // fourth 'choice' flag; fold consecutive members into one choice item.
  for (let i = 0; i < raw.length; i++) {
    const [item, isChoice] = raw[i];
    if (!isChoice) {
      items.push(item);
      continue;
    }
    const members = [item];
    while (i + 1 < raw.length && raw[i + 1][1]) members.push(raw[++i][0]);
    items.push({ choice: members.map((m) => ({ ...m, required: undefined })).map(({ required, ...m }) => m), required: true, repeating: false });
  }
  return items;
}
const HAPI_ONLY_STRUCTURES = new Set(["ADT_AXX"]); // HAPI's synthetic superset of all ADT structures
const hapiStructures = {};
for (const [cls, src] of javaFiles(path.join(HAPI, "message"))) {
  if (HAPI_ONLY_STRUCTURES.has(cls)) continue;
  const ch = /\(see chapter ([\d.]+)\)/.exec(src);
  hapiStructures[cls] = { chapter: ch ? ch[1] : null, segments: expand(src) };
}
const eventMap = Object.fromEntries(
  fs
    .readFileSync(EVENTMAP, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/))
);

// ─── Tables ─────────────────────────────────────────────────────────────────
const boundTables = new Set();
Object.values(hapiSegments).forEach((s) => s.fields.forEach((f) => f.table && boundTables.add(f.table)));
Object.values(hapiDatatypes).forEach((d) => d.components.forEach((c) => c.table && boundTables.add(c.table)));
for (const o of overrides.fields ?? []) if (o.set?.table) boundTables.add(o.set.table);
const tableIds = new Set([...boundTables, ...Object.keys(overlay.tables)]);
for (const [id, m] of thoMeta) {
  const intro = m.props["v2-version-tbl-introduced"];
  if (/^\d{4}$/.test(id) && intro && vnum(intro) <= V251) tableIds.add(id);
}
tableIds.delete("0000");

const tables = {};
const tableStats = { tables: 0, codes: 0, valid: 0, notIn251: 0, unverified: 0, tablesWithoutValues: 0 };
for (const id of [...tableIds].sort()) {
  const meta = thoMeta.get(id);
  const tho = thoCodes(id);
  const stu3 = readStu3(id);
  const ov = overlay.tables[id];
  const intro = meta?.props["v2-version-tbl-introduced"] ?? null;
  if (intro && vnum(intro) > V251 && !boundTables.has(id) && !ov) continue;
  const codes = new Map();
  for (const c of tho?.codes ?? []) codes.set(c.code, { code: c.code, display: c.display, definition: c.definition && c.definition !== c.display ? c.definition : undefined, sources: ["THO"], deprecatedIn: c.deprecatedIn });
  for (const [code, r] of stu3?.rows ?? []) {
    if (!codes.has(code)) codes.set(code, { code, display: r.display, sources: ["FHIR-STU3"] });
    else codes.get(code).sources.push("FHIR-STU3");
  }
  for (const v of ov?.values ?? []) {
    const k = v.code;
    if (!codes.has(k)) codes.set(k, { code: k, display: v.desc, sources: ["overlay"] });
    else codes.get(k).sources.push("overlay");
    codes.get(k).note = v.desc && v.desc !== codes.get(k).display ? v.desc : undefined;
  }
  const values = [];
  for (const c of codes.values()) {
    const hist = stu3?.rows.get(c.code);
    let cls;
    if (hist) cls = classify(hist.version);
    else if (stu3 && stu3.rows.size > 0)
      cls = { status: "unverified", reason: "Not listed in the FHIR STU3 v2 table (which records v2.1–v2.8.2 history); most likely added after v2.8.2. Not confirmed for v2.5.1." };
    else cls = { status: "unverified", reason: "No per-version history available for this table." };
    const entry = {
      code: c.code,
      display: c.display ?? null,
      ...(c.definition ? { definition: c.definition } : {}),
      ...(c.note ? { note: c.note } : {}),
      status: cls.status,
      history: hist?.version || null,
      ...(cls.status !== "valid" ? { reason: cls.reason } : {}),
      ...(hist?.comment && /deprecat/i.test(hist.comment) ? { deprecated: true } : {}),
      ...(c.deprecatedIn ? { deprecatedIn: c.deprecatedIn } : {}),
      sources: c.sources,
    };
    values.push(entry);
    tableStats.codes++;
    if (cls.status === "valid") tableStats.valid++;
    else if (cls.status === "not-in-2.5.1") tableStats.notIn251++;
    else tableStats.unverified++;
  }
  for (const o of (overrides.tableCodes ?? []).filter((x) => x.table === id)) {
    const v = values.find((x) => x.code === o.code);
    if (!v) throw new Error(`Table override ${id}:${o.code} targets a code no source lists.`);
    const before = v.status;
    v.status = o.status;
    v.reason = o.evidence;
    tableStats[before === "valid" ? "valid" : before === "not-in-2.5.1" ? "notIn251" : "unverified"]--;
    tableStats[o.status === "valid" ? "valid" : o.status === "not-in-2.5.1" ? "notIn251" : "unverified"]++;
  }
  if (!values.length) tableStats.tablesWithoutValues++;
  tableStats.tables++;
  tables[id] = {
    id,
    name: ov?.name ?? meta?.name ?? null,
    type: meta?.props["v2-table-type"] ?? null,
    introduced: intro,
    whereUsed: meta?.props["v2-where-used"] ?? null,
    system: tho?.url ?? (meta ? `http://terminology.hl7.org/CodeSystem/v2-${id}` : null),
    valueSource: values.length ? [...new Set(values.flatMap((v) => v.sources))] : [],
    boundIn251: boundTables.has(id),
    values,
  };
}

const tableValid = (id) => new Set((tables[id]?.values ?? []).filter((v) => v.status === "valid").map((v) => v.code));
const t0440 = new Map((tables["0440"]?.values ?? []).map((v) => [v.code, v]));
const t0354 = new Map((tables["0354"]?.values ?? []).map((v) => [v.code, v]));
const t0003 = new Map((tables["0003"]?.values ?? []).map((v) => [v.code, v]));
const t0076 = new Map((tables["0076"]?.values ?? []).map((v) => [v.code, v]));

// ─── Coded-field bindings from THO "where used" ─────────────────────────────
// HAPI only records table numbers for ID/IS fields. For CE/CWE/CNE fields we
// take the binding from THO's v2-where-used table property, but only when the
// field exists in HAPI 2.5.1 with a coded type, exactly one table claims it,
// and that table was introduced in v2.5.1 or earlier. THO reflects the latest
// v2 version, so these bindings are tagged with their source.
const CODED = new Set(["CE", "CWE", "CNE", "CF", "ID", "IS"]);
const whereUsed = new Map();
for (const [id, m] of thoMeta) {
  const wu = m.props["v2-where-used"];
  if (!wu || !/^\d{4}$/.test(id) || !tables[id]) continue;
  const intro = m.props["v2-version-tbl-introduced"];
  if (!intro || vnum(intro) > V251) continue;
  for (const tok of wu.split(/[,;]\s*/)) {
    const t = tok.trim();
    if (/^[A-Z][A-Z0-9]{2}-\d+$/.test(t) || /^[A-Z]{2,3}\.\d+$/.test(t)) {
      if (!whereUsed.has(t)) whereUsed.set(t, new Set());
      whereUsed.get(t).add(id);
    }
  }
}
const bindingStats = { fields: 0, components: 0, ambiguous: 0 };
function thoBinding(loc, type) {
  const ids = whereUsed.get(loc);
  if (!ids || !CODED.has(type)) return null;
  if (ids.size !== 1) {
    bindingStats.ambiguous++;
    return { candidates: [...ids].sort() };
  }
  return { table: [...ids][0] };
}

// ─── Merge segments ─────────────────────────────────────────────────────────
const fieldOverrides = new Map((overrides.fields ?? []).map((o) => [o.location, o]));
const segments = {};
const fieldStats = { segments: 0, fields: 0, withCuratedDescription: 0, withdrawn: 0, overridden: 0 };
for (const [code, h] of Object.entries(hapiSegments).sort(([a], [b]) => a.localeCompare(b))) {
  const ov = overlay.segments[code];
  const fields = h.fields.map((f) => {
    const of = ov?.fields.find((x) => x.seq === f.seq);
    const withdrawn = f.type === "NULLDT";
    let opt = f.req ? "R" : "O";
    let optSource = "HAPI (R/O only)";
    if (withdrawn) {
      opt = "W";
      optSource = "HAPI (NULLDT = withdrawn)";
    } else if (of && ["C", "B"].includes(of.opt) && !(of.opt === "C" && f.req)) {
      opt = of.opt;
      optSource = "overlay (curated)";
    }
    const rec = {
      seq: f.seq,
      name: f.name,
      type: withdrawn ? null : f.type === "Varies" ? "varies" : f.type,
      opt,
      rpt: f.maxReps === 0 ? "*" : f.maxReps,
      len: f.len || null,
      table: f.table,
      ...(of?.desc ? { desc: of.desc } : {}),
      src: { structure: "HAPI", opt: optSource, ...(of?.desc ? { desc: "overlay" } : {}) },
    };
    if (of?.desc) fieldStats.withCuratedDescription++;
    if (withdrawn) fieldStats.withdrawn++;
    if (!rec.table && !withdrawn) {
      const b = thoBinding(`${code}-${f.seq}`, f.type);
      if (b?.table) {
        rec.table = b.table;
        rec.src.table = "THO v2-where-used (latest v2 version; not confirmed for 2.5.1)";
        bindingStats.fields++;
      } else if (b?.candidates) rec.tableCandidates = b.candidates;
    } else if (rec.table) rec.src.table = "HAPI";
    const o = fieldOverrides.get(`${code}-${f.seq}`);
    if (o) {
      Object.assign(rec, o.set);
      rec.src.override = o.evidence;
      fieldStats.overridden++;
    }
    return rec;
  });
  for (const o of overrides.fields ?? []) {
    const [s, n] = o.location.split("-");
    if (s === code && !fields.find((x) => x.seq === +n)) throw new Error(`Override ${o.location} targets a field HAPI does not define.`);
  }
  segments[code] = {
    code,
    name: h.name,
    ...(ov?.description ? { description: ov.description } : {}),
    fields,
    src: { structure: "HAPI hapi-structures-v251 2.5.1", ...(ov ? { description: "overlay" } : {}) },
  };
  fieldStats.segments++;
  fieldStats.fields += fields.length;
}
// Z-segments and other curated-only segments
for (const [code, ov] of Object.entries(overlay.segments)) {
  if (segments[code]) continue;
  segments[code] = {
    code,
    name: ov.name,
    description: ov.description,
    zSegment: code.startsWith("Z"),
    fields: ov.fields.map((f) => ({ seq: f.seq, name: f.name, type: f.type, opt: f.opt, rpt: f.rpt === "∞" ? "*" : f.rpt, len: f.len, table: null, desc: f.desc, src: { structure: "overlay" } })),
    src: { structure: "overlay (not part of the v2.5.1 standard)" },
  };
}

// ─── Datatypes ──────────────────────────────────────────────────────────────
const datatypes = {};
for (const [code, d] of Object.entries(hapiDatatypes).sort(([a], [b]) => a.localeCompare(b))) {
  const t = t0440.get(code);
  datatypes[code] = {
    code,
    name: d.name ?? t?.display ?? null,
    kind: d.components.length ? "composite" : "primitive",
    components: d.components.map((c) => {
      const comp = { seq: c.seq, name: c.name ?? null, type: c.type, table: c.table };
      if (!c.table) {
        const b = thoBinding(`${code}.${c.seq}`, c.type);
        if (b?.table) {
          comp.table = b.table;
          comp.tableSource = "THO v2-where-used (latest v2 version; not confirmed for 2.5.1)";
          bindingStats.components++;
        }
      }
      return comp;
    }),
    ...(t ? { table0440: { status: t.status, history: t.history } } : {}),
    src: { structure: "HAPI", ...(d.name ? {} : t ? { name: "THO table 0440" } : {}) },
  };
}

// ─── Structures and events ──────────────────────────────────────────────────
const structures = {};
for (const [id, s] of Object.entries(hapiStructures).sort(([a], [b]) => a.localeCompare(b))) {
  const t = t0354.get(id);
  structures[id] = {
    id,
    chapter: s.chapter,
    description: t?.display ?? null,
    table0354: t ? { status: t.status, history: t.history } : { status: "unverified", reason: "Not in table 0354." },
    segments: s.segments,
    src: { structure: "HAPI", ...(t ? { description: "table 0354" } : {}) },
  };
}
function abstractSyntax(items) {
  return items
    .map((i) => {
      let inner = i.choice
        ? `< ${i.choice.map((c) => (c.segment ? c.segment : abstractSyntax(c.children))).join(" | ")} >`
        : i.segment
          ? i.segment
          : abstractSyntax(i.children);
      if (i.repeating) inner = `{ ${inner} }`;
      if (!i.required) inner = `[ ${inner} ]`;
      return inner;
    })
    .join(" ");
}
for (const s of Object.values(structures)) s.abstractSyntax = abstractSyntax(s.segments).replace(/\s+/g, " ");

const events = {};
const addEvent = (key, structure, how) => {
  const [msg, ev] = key.split("_");
  if (!ev) return;
  const k = `${msg}^${ev}`;
  if (events[k]) return;
  const t3 = t0003.get(ev);
  const t76 = t0076.get(msg);
  const ov = overlay.messages[k];
  events[k] = {
    messageType: msg,
    event: ev,
    structure,
    description: t3?.display ?? null,
    messageTypeName: t76?.display ?? null,
    table0003: t3 ? { status: t3.status, history: t3.history } : { status: "unverified" },
    table0076: t76 ? { status: t76.status, history: t76.history } : { status: "unverified" },
    ...(ov ? { curated: { description: ov.description, notes: ov.notes ?? null, abstractSyntax: ov.abstractSyntax ?? null } } : {}),
    src: { mapping: how, ...(t3 ? { description: "table 0003" } : {}) },
  };
};
for (const [k, s] of Object.entries(eventMap)) if (structures[s]) addEvent(k, s, "HAPI eventmap 2.5.1");
for (const id of Object.keys(structures)) if (/^[A-Z]{3}_[A-Z0-9]{3}$/.test(id) && !/^(QBP_Qnn|RTB_Knn|MFN_Znn)$/.test(id)) addEvent(id, id, "HAPI structure name");
// ACK has no trigger in its structure name
const ackOv = overlay.messages["ACK"];
const eventsSorted = Object.fromEntries(Object.entries(events).sort(([a], [b]) => a.localeCompare(b)));

// ─── Write ──────────────────────────────────────────────────────────────────
const write = (name, obj) => fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 1) + "\n");
write("segments.json", segments);
write("datatypes.json", datatypes);
write("structures.json", structures);
write("events.json", { ...eventsSorted, ...(ackOv ? { ACK: { messageType: "ACK", event: null, structure: "ACK", description: ackOv.description, curated: { description: ackOv.description, notes: ackOv.notes ?? null }, src: { mapping: "overlay" } } } : {}) });
write("tables.json", tables);
const meta = {
  standard: "HL7 v2.5.1",
  generator: "core/scripts/generate.mjs",
  sources: readJson(path.join(SRC, "sources.json")),
  counts: {
    segments: fieldStats.segments,
    zSegments: Object.values(segments).filter((s) => s.zSegment).length,
    fields: fieldStats.fields,
    fieldsWithCuratedDescription: fieldStats.withCuratedDescription,
    withdrawnFields: fieldStats.withdrawn,
    overriddenFields: fieldStats.overridden,
    datatypes: Object.keys(datatypes).length,
    compositeDatatypes: Object.values(datatypes).filter((d) => d.kind === "composite").length,
    structures: Object.keys(structures).length,
    structuresVerifiedInTable0354: Object.values(structures).filter((s) => s.table0354.status === "valid").length,
    events: Object.keys(eventsSorted).length,
    eventsVerifiedInTable0003: Object.values(eventsSorted).filter((e) => e.table0003.status === "valid").length,
    ...Object.fromEntries(Object.entries(tableStats).map(([k, v]) => [`table_${k}`, v])),
    tablesBoundToFields: boundTables.size,
    thoWhereUsedBindings: bindingStats,
  },
};
write("meta.json", meta);
console.log(JSON.stringify(meta.counts, null, 1));
