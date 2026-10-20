/**
 * Read-only access to the generated HL7 v2.5.1 reference data in ../data.
 * Files are loaded lazily on first use and cached.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8")));
  return cache.get(name);
}

export const dataDir = DATA_DIR;
export const meta = () => load("meta");
export const segments = () => load("segments");
export const datatypes = () => load("datatypes");
export const structures = () => load("structures");
export const events = () => load("events");
export const tables = () => load("tables");

/** Normalise a table id: "123", "0123", "HL70123", "v2-0123" → "0123". */
export function normalizeTableId(id) {
  const m = /(\d{1,4})\s*$/.exec(String(id ?? "").trim());
  return m ? m[1].padStart(4, "0") : String(id ?? "").trim();
}

/** Normalise an event key: "adt^a04", "ADT_A04", "ADT A04" → "ADT^A04". */
export function normalizeEventKey(key) {
  const k = String(key ?? "").trim().toUpperCase().replace(/[_\s|-]+/g, "^");
  return k.split("^").slice(0, 2).join("^");
}

export const getSegment = (code) => segments()[String(code ?? "").trim().toUpperCase()] ?? null;
export function getField(segment, seq) {
  const s = getSegment(segment);
  return s ? s.fields.find((f) => f.seq === Number(seq)) ?? null : null;
}
export const getDatatype = (code) => datatypes()[String(code ?? "").trim().toUpperCase()] ?? null;
export const getTable = (id) => tables()[normalizeTableId(id)] ?? null;

/** Structure by id (ORM_O01) or by message type/event (ORM^O01, ADT^A04 → ADT_A01). */
export function getStructure(idOrEvent) {
  const raw = String(idOrEvent ?? "").trim().toUpperCase();
  const s = structures();
  if (s[raw]) return { structure: s[raw], event: null };
  const ev = getEvent(raw);
  if (ev && s[ev.structure]) return { structure: s[ev.structure], event: ev };
  return null;
}
export function getEvent(key) {
  const e = events();
  const raw = String(key ?? "").trim().toUpperCase();
  if (raw === "ACK" && e.ACK) return e.ACK;
  return e[normalizeEventKey(raw)] ?? null;
}

/** Codes of a table by 2.5.1 status. */
export function tableCodes(id, { status } = {}) {
  const t = getTable(id);
  if (!t) return [];
  return t.values.filter((v) => !status || (Array.isArray(status) ? status.includes(v.status) : v.status === status));
}

/**
 * Classify one code against a table for v2.5.1:
 *  { known: false } when the code is not in any source;
 *  otherwise { known: true, status: "valid" | "not-in-2.5.1" | "unverified", entry }.
 */
export function checkCode(id, code) {
  const t = getTable(id);
  if (!t) return { table: null, known: false };
  const entry = t.values.find((v) => v.code === String(code)) ?? t.values.find((v) => v.code.toUpperCase() === String(code).toUpperCase());
  if (!entry) return { table: t, known: false };
  return { table: t, known: true, status: entry.status, entry };
}

/** Set of codes verified as valid in v2.5.1 (uppercase). */
export function validCodeSet(id) {
  return new Set(tableCodes(id, { status: "valid" }).map((v) => v.code.toUpperCase()));
}

/**
 * Paginate an array. Returns { total, offset, limit, items, nextOffset }.
 */
export function paginate(items, offset = 0, limit = 50) {
  const o = Math.max(0, Math.floor(offset || 0));
  const l = Math.max(1, Math.floor(limit || 50));
  const slice = items.slice(o, o + l);
  return { total: items.length, offset: o, limit: l, items: slice, nextOffset: o + l < items.length ? o + l : null };
}
