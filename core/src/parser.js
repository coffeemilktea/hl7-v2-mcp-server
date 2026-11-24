/**
 * Dependency-free HL7 v2 message parser shared by both MCP servers.
 *
 * Positions follow the standard's numbering: field 1 of MSH (and FHS/BHS) is
 * the field separator and field 2 the encoding characters, so MSH-9 is MSH-9.
 */

const DEFAULTS = { fieldSep: "|", compSep: "^", repSep: "~", escChar: "\\", subSep: "&" };
const HEADER = /^(MSH|FHS|BHS)/;

/** HL7 explicit null: `""` means "delete/clear this value", distinct from an empty (not sent) value. */
export const NULL_VALUE = '""';
export const isNull = (v) => v === NULL_VALUE;

/** Strip MLLP framing and leading whitespace; normalise \r\n and \n segment terminators to \r. */
export function normalize(message) {
  let raw = String(message ?? "");
  raw = raw.replace(/^\s*\x0B/, "").replace(/\x1C\x0D?\s*$/, "").replace(/^\s+/, "");
  return raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

/** split() that treats a missing ("") separator as "no split". */
const splitOn = (s, sep) => (sep ? String(s).split(sep) : [String(s)]);

/**
 * Split a message into segment lines and recover its delimiters from MSH-1/MSH-2.
 * MSH-2 is read only up to the next field separator, so a short MSH-2 never
 * borrows the field separator as a delimiter. A missing encoding character
 * falls back to its default unless that character is already in use.
 */
export function dissect(message) {
  const lines = normalize(message)
    .split("\r")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .filter((l) => l.length > 0);
  const msh = lines[0] ?? "";
  if (!HEADER.test(msh) || msh.length < 4) return { lines, ...DEFAULTS, charset: null };
  const fieldSep = msh[3];
  const enc = msh.slice(4).split(fieldSep)[0];
  const used = new Set([fieldSep]);
  const pick = (i, def) => {
    let ch = enc[i];
    if (ch === undefined) ch = used.has(def) ? "" : def;
    if (ch) used.add(ch);
    return ch;
  };
  const compSep = pick(0, DEFAULTS.compSep);
  const repSep = pick(1, DEFAULTS.repSep);
  const escChar = pick(2, DEFAULTS.escChar);
  const subSep = pick(3, DEFAULTS.subSep);
  // MSH-18 Character Set decides how \Xhh..\ bytes are decoded.
  const msh18 = msh.startsWith("MSH") ? msh.split(fieldSep)[17] ?? "" : "";
  const charset = /UTF-8/i.test(msh18) ? "utf-8" : msh18 ? msh18 : null;
  return { lines, fieldSep, compSep, repSep, escChar, subSep, charset };
}

/** The delimiters of a dissected message, without the lines. */
export const delimitersOf = (ctx) => ({
  fieldSep: ctx.fieldSep,
  compSep: ctx.compSep,
  repSep: ctx.repSep,
  escChar: ctx.escChar,
  subSep: ctx.subSep,
});

/**
 * 1-based field accessor for a segment line. MSH is offset-corrected so f(1) is
 * the field separator and f(2) the encoding characters.
 */
export function fielder(line, fieldSep = "|") {
  const isMsh = HEADER.test(line);
  const parts = line.split(fieldSep);
  return (n) => (isMsh ? (n === 1 ? fieldSep : parts[n - 1] ?? "") : parts[n] ?? "");
}

/** Number of fields present on a segment line (standard numbering). */
export function fieldCount(line, fieldSep = "|") {
  const n = line.split(fieldSep).length - 1;
  return HEADER.test(line) ? n + 1 : n;
}

/** Component n (1-based) of a raw value, trimmed. Not unescaped. */
export const comp = (val, n, sep = "^") => (splitOn(val ?? "", sep)[n - 1] ?? "").trim();
/** Non-empty repetitions of a raw value. */
export const reps = (val, sep = "~") => splitOn(val ?? "", sep).filter((x) => x.trim().length > 0);

function hexBytes(hex, charset) {
  const bytes = Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  if (charset === "utf-8") return new TextDecoder("utf-8").decode(bytes);
  return String.fromCharCode(...bytes); // ASCII / ISO 8859-1
}

/**
 * Decode HL7 escape sequences in one pass: \F\ \S\ \T\ \R\ \E\, \Xhh..\ (UTF-8
 * when MSH-18 says so, otherwise ISO 8859-1), \.br\ and \.sp n\ as line breaks;
 * highlighting (\H\ \N\) and other formatting commands are dropped. Unknown
 * sequences (\Cxxyy\, \Mxxyyzz\, \Zxx\ local escapes) are left as-is.
 */
export function unescape(value, ctx = DEFAULTS) {
  if (value === undefined || value === null || value === "") return value;
  const s = String(value);
  const e = ctx.escChar ?? DEFAULTS.escChar;
  if (!e || !s.includes(e)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== e) {
      out += ch;
      continue;
    }
    const end = s.indexOf(e, i + 1);
    if (end === -1) {
      out += s.slice(i);
      break;
    }
    const seq = s.slice(i + 1, end);
    let rep;
    let m;
    if (seq === "F") rep = ctx.fieldSep;
    else if (seq === "S") rep = ctx.compSep;
    else if (seq === "T") rep = ctx.subSep;
    else if (seq === "R") rep = ctx.repSep;
    else if (seq === "E") rep = e;
    else if (seq === ".br") rep = "\n";
    else if ((m = /^\.sp\s*(\d*)$/.exec(seq))) rep = "\n".repeat(Math.max(1, Number(m[1] || 1)));
    else if (seq === "H" || seq === "N") rep = "";
    else if (/^X([0-9A-Fa-f]{2})+$/.test(seq)) rep = hexBytes(seq.slice(1), ctx.charset);
    else if (/^\.(fi|nf|in|ti|sk|ce)/.test(seq)) rep = "";
    out += rep === undefined ? s.slice(i, end + 1) : rep;
    i = end;
  }
  return out;
}

/** Encode text so it is safe inside one component/subcomponent. Line breaks become \.br\. */
export function escape(value, ctx = DEFAULTS) {
  if (value === undefined || value === null) return "";
  const e = ctx.escChar || DEFAULTS.escChar;
  let out = "";
  for (const ch of String(value).replace(/\r\n/g, "\n")) {
    if (ch === e) out += `${e}E${e}`;
    else if (ch === ctx.fieldSep) out += `${e}F${e}`;
    else if (ch === ctx.compSep) out += `${e}S${e}`;
    else if (ch === ctx.subSep) out += `${e}T${e}`;
    else if (ch === ctx.repSep) out += `${e}R${e}`;
    else if (ch === "\r" || ch === "\n") out += `${e}.br${e}`;
    else out += ch;
  }
  return out;
}

/** Split one raw field into repetitions → components → subcomponents (decoded). */
export function splitField(raw, ctx = DEFAULTS, { isEncodingField = false } = {}) {
  if (isEncodingField) return [[[raw]]];
  return splitOn(raw ?? "", ctx.repSep).map((rep) =>
    splitOn(rep, ctx.compSep).map((c) => splitOn(c, ctx.subSep).map((s) => unescape(s, ctx)))
  );
}

/**
 * Parse a message into a structured tree.
 * Returns { delimiters, segments: [{ name, index, line, fields: [{ seq, raw, reps }] }] }
 * where reps is [rep][component][subcomponent] of decoded strings. An HL7
 * explicit null stays the literal string `""` (see isNull).
 */
export function parseMessage(message) {
  const ctx = dissect(message);
  if (ctx.lines.length === 0) throw new Error("No segments found in message.");
  if (!HEADER.test(ctx.lines[0])) throw new Error(`Message must begin with an MSH segment (found '${ctx.lines[0].slice(0, 3)}').`);
  if (ctx.lines[0].length < 8) throw new Error("MSH is too short: it must start with MSH, the field separator and the encoding characters, e.g. MSH|^~\\&|.");
  const segments = ctx.lines.map((line, index) => {
    const name = line.slice(0, 3);
    const isMsh = HEADER.test(name);
    const parts = line.split(ctx.fieldSep);
    const fields = [];
    if (isMsh) {
      fields.push({ seq: 1, raw: ctx.fieldSep, reps: [[[ctx.fieldSep]]] });
      fields.push({ seq: 2, raw: parts[1] ?? "", reps: [[[parts[1] ?? ""]]] });
      parts.slice(2).forEach((raw, i) => fields.push({ seq: i + 3, raw, reps: splitField(raw, ctx) }));
    } else {
      parts.slice(1).forEach((raw, i) => fields.push({ seq: i + 1, raw, reps: splitField(raw, ctx) }));
    }
    return { name, index: index + 1, line, fields };
  });
  return { delimiters: delimitersOf(ctx), segments };
}

/**
 * Parse a location such as "PID-3", "PID-3.4", "PID-3[2].4.1", "OBX[2]-5" or
 * "PID.3.1". Segment occurrence and repetition are 1-based.
 */
export function parsePath(path) {
  const m = /^([A-Z][A-Z0-9]{2})(?:\[(\d+)\])?(?:[-.](\d+)(?:\[(\d+)\])?(?:\.(\d+)(?:\.(\d+))?)?)?$/i.exec(String(path).trim());
  if (!m) return null;
  return {
    segment: m[1].toUpperCase(),
    occurrence: m[2] ? +m[2] : 1,
    field: m[3] ? +m[3] : undefined,
    repetition: m[4] ? +m[4] : undefined,
    component: m[5] ? +m[5] : undefined,
    subcomponent: m[6] ? +m[6] : undefined,
  };
}

/**
 * Read a decoded value from a parsed message by path. Returns undefined when
 * absent. A path without [n] reads the first repetition.
 */
export function getValue(parsed, path) {
  const p = typeof path === "string" ? parsePath(path) : path;
  if (!p) throw new Error(`Invalid path '${path}'. Use e.g. PID-3, PID-3[2].4 or OBX[2]-5.1.`);
  const seg = parsed.segments.filter((s) => s.name === p.segment)[p.occurrence - 1];
  if (!seg) return undefined;
  if (!p.field) return seg.line;
  const f = seg.fields.find((x) => x.seq === p.field);
  if (!f) return undefined;
  if (p.field <= 2 && HEADER.test(seg.name)) return f.raw;
  const rep = f.reps[(p.repetition ?? 1) - 1];
  if (!rep) return undefined;
  if (!p.component) return rep.map((c) => c.join(parsed.delimiters.subSep)).join(parsed.delimiters.compSep);
  const c = rep[p.component - 1];
  if (!c) return undefined;
  if (!p.subcomponent) return c.join(parsed.delimiters.subSep);
  return c[p.subcomponent - 1];
}

function trimTrailing(parts) {
  let n = parts.length;
  while (n > 1 && (parts[n - 1] === "" || parts[n - 1] === undefined || parts[n - 1] === null)) n--;
  return parts.slice(0, n).map((x) => x ?? "");
}

/**
 * Build one segment line from an array of raw (already-encoded) field values,
 * dropping trailing empty fields. For MSH, fields[0] is MSH-1 (ignored; the
 * context's separator is used) and fields[1] is MSH-2.
 */
export function buildSegment(name, fields, ctx = DEFAULTS) {
  if (/^(MSH|FHS|BHS)$/.test(name)) {
    const enc = fields[1] || `${ctx.compSep}${ctx.repSep}${ctx.escChar}${ctx.subSep}`;
    return trimTrailing([name, enc, ...fields.slice(2)]).join(ctx.fieldSep);
  }
  return trimTrailing([name, ...fields]).join(ctx.fieldSep);
}
