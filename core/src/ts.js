/** HL7 v2.5.1 TS/DTM handling shared by the validator and the FHIR converter. */

export const TS_RE = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\.\d{1,4})?([+-]\d{4})?$/;

/**
 * Check a TS value (component 1 already extracted). Returns
 * { ok, errors: [msg], warnings: [msg] } without throwing.
 */
export function checkTimestamp(value) {
  const v = String(value ?? "").trim();
  const errors = [];
  const warnings = [];
  if (!v) return { ok: true, errors, warnings };
  const m = TS_RE.exec(v);
  if (!m) {
    errors.push(`'${v}' is not a valid TS timestamp. Expected YYYY[MM[DD[HH[MM[SS[.SSSS]]]]]][+/-ZZZZ].`);
    return { ok: false, errors, warnings };
  }
  const [, , mo, d, h, mi, s] = m;
  if (mo && (+mo < 1 || +mo > 12)) errors.push(`Month '${mo}' is out of range.`);
  if (d && (+d < 1 || +d > 31)) errors.push(`Day '${d}' is out of range.`);
  if (h && +h > 23) errors.push(`Hour '${h}' is out of range.`);
  if (mi && +mi > 59) errors.push(`Minute '${mi}' is out of range.`);
  if (s && +s > 60) errors.push(`Second '${s}' is out of range.`);
  if (h && !/[+-]\d{4}$/.test(v)) {
    warnings.push("No timezone offset. Without one the receiver applies its own locale, which shifts study and report times across sites.");
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** HL7 TS/DTM → FHIR date | dateTime, preserving the source precision. */
export function toFhirDate(ts) {
  const v = String(ts ?? "").trim();
  if (!v) return undefined;
  const m = TS_RE.exec(v);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, frac, tz] = m;
  if (!mo) return y;
  if (!d) return `${y}-${mo}`;
  if (!h) return `${y}-${mo}-${d}`;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "";
  const time = `${h}:${mi ?? "00"}:${s ?? "00"}${s && frac ? frac : ""}`;
  return `${y}-${mo}-${d}T${time}${offset}`;
}

/** True when a converted timestamp carries a time but no zone offset. */
export const zonelessTime = (fhirDate) => Boolean(fhirDate && fhirDate.includes("T") && !/[+-]\d{2}:\d{2}$/.test(fhirDate));

/** Current time as an HL7 TS with seconds and offset, e.g. 20261019203000-0700. */
export function nowTs(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${sign}${p(Math.floor(a / 60))}${p(a % 60)}`;
}
