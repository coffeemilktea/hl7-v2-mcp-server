/** Free-text search across segments, fields, datatypes, events, structures and tables. */
import { segments, datatypes, events, structures, tables } from "./data.js";

let index = null;
function build() {
  const docs = [];
  for (const s of Object.values(segments())) {
    docs.push({ kind: "segment", id: s.code, title: `${s.code} — ${s.name}`, text: `${s.code} ${s.name} ${s.description ?? ""}` });
    for (const f of s.fields) {
      docs.push({ kind: "field", id: `${s.code}-${f.seq}`, title: `${s.code}-${f.seq} ${f.name}`, text: `${s.code}-${f.seq} ${f.name} ${f.type ?? ""} ${f.table ? "table " + f.table : ""} ${f.desc ?? ""}` });
    }
  }
  for (const d of Object.values(datatypes())) {
    docs.push({ kind: "datatype", id: d.code, title: `${d.code} — ${d.name ?? ""}`, text: `${d.code} ${d.name ?? ""} ${d.components.map((c) => c.name).join(" ")}` });
  }
  for (const [k, e] of Object.entries(events())) {
    docs.push({ kind: "event", id: k, title: `${k} — ${e.description ?? e.curated?.description ?? ""}`, text: `${k} ${e.structure ?? ""} ${e.description ?? ""} ${e.curated?.description ?? ""} ${e.curated?.notes ?? ""}` });
  }
  for (const s of Object.values(structures())) {
    docs.push({ kind: "structure", id: s.id, title: `${s.id} — ${s.description ?? ""}`, text: `${s.id} ${s.description ?? ""}` });
  }
  for (const t of Object.values(tables())) {
    docs.push({ kind: "table", id: t.id, title: `Table ${t.id} — ${t.name ?? ""}`, text: `table ${t.id} ${t.name ?? ""} ${t.whereUsed ?? ""}` });
    for (const v of t.values) {
      docs.push({ kind: "code", id: `${t.id}:${v.code}`, title: `${t.id} ${v.code} — ${v.display ?? ""}`, text: `${v.code} ${v.display ?? ""} ${v.note ?? ""}`, status: v.status });
    }
  }
  for (const d of docs) d.lc = d.text.toLowerCase();
  return docs;
}

const tokens = (q) => String(q).toLowerCase().split(/[^a-z0-9.\-^]+/).filter(Boolean);

/**
 * Search; every token must match. Exact id matches rank first, then title hits.
 * kinds: optional array of kinds to restrict to.
 */
export function search(query, { kinds, offset = 0, limit = 25 } = {}) {
  if (!index) index = build();
  const q = String(query ?? "").trim();
  const toks = tokens(q);
  if (!toks.length) return { total: 0, offset, limit, items: [], nextOffset: null };
  const ql = q.toLowerCase();
  const hits = [];
  for (const d of index) {
    if (kinds && kinds.length && !kinds.includes(d.kind)) continue;
    if (!toks.every((t) => d.lc.includes(t))) continue;
    const idl = d.id.toLowerCase();
    let score = 0;
    if (idl === ql) score += 100;
    else if (idl.startsWith(ql)) score += 40;
    const tl = d.title.toLowerCase();
    if (tl.includes(ql)) score += 20;
    for (const t of toks) if (tl.includes(t)) score += 5;
    if (d.kind === "segment" || d.kind === "table" || d.kind === "datatype") score += 3;
    else if (d.kind === "field" || d.kind === "event") score += 2;
    if (d.status && d.status !== "valid") score -= 25;
    hits.push({ score, kind: d.kind, id: d.id, title: d.title, ...(d.status ? { status: d.status } : {}) });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const o = Math.max(0, offset);
  const items = hits.slice(o, o + limit).map(({ score, ...h }) => h);
  return { total: hits.length, offset: o, limit, items, nextOffset: o + limit < hits.length ? o + limit : null };
}
