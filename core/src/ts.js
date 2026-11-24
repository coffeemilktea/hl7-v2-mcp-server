/**
 * HL7 v2.5.1 primitive formats (DTM/TS, DT, TM, NM, SI), shared by the
 * validator and the FHIR converter.
 *
 * DTM: YYYY[MM[DD[HH[MM[SS[.S[S[S[S]]]]]]]]][+/-ZZZZ]   (fraction only after seconds)
 * DT:  YYYY[MM[DD]]
 * TM:  HH[MM[SS[.S[S[S[S]]]]]][+/-ZZZZ]
 */

// Capture groups: 1 year, 2 month, 3 day, 4 hour, 5 minute, 6 second, 7 fraction, 8 offset.
export const TS_RE = /^(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(\.\d{1,4})?)?)?)?)?)?([+-]\d{4})?$/;
export const DT_RE = /^(\d{4})(?:(\d{2})(\d{2})?)?$/;
export const TM_RE = /^(\d{2})(?:(\d{2})(?:(\d{2})(\.\d{1,4})?)?)?([+-]\d{4})?$/;
/** NM: optional sign, digits, optional decimal point; no exponent, no thousands separators. */
export const NM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
/** SI: non-negative integer, at most 4 digits. */
export const SI_RE = /^\d{1,4}$/;

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function rangeErrors({ y, mo, d, h, mi, s, tz }, errors) {
  if (mo && (+mo < 1 || +mo > 12)) errors.push(`Month '${mo}' is out of range.`);
  else if (d && (+d < 1 || +d > daysIn(+y, +mo))) errors.push(`Day '${d}' is out of range for ${y}-${mo}.`);
  if (h && +h > 23) errors.push(`Hour '${h}' is out of range.`);
  if (mi && +mi > 59) errors.push(`Minute '${mi}' is out of range.`);
  if (s && +s > 60) errors.push(`Second '${s}' is out of range.`);
  if (tz && (+tz.slice(1, 3) > 14 || +tz.slice(3) > 59)) errors.push(`Time zone offset '${tz}' is out of range (-1200 to +1400).`);
}

/**
 * Check a TS/DTM value (component 1 already extracted). Returns
 * { ok, errors, warnings, zoneless } without throwing. `zoneless` is true when
 * the value carries a time but no UTC offset (allowed in v2.5.1: the sender's
 * local time is implied).
 */
export function checkTimestamp(value) {
  const v = String(value ?? "").trim();
  const errors = [];
  const warnings = [];
  if (!v) return { ok: true, errors, warnings, zoneless: false };
  const m = TS_RE.exec(v);
  if (!m) {
    errors.push(`'${v}' is not a valid DTM. Expected YYYY[MM[DD[HH[MM[SS[.S[S[S[S]]]]]]]]][+/-ZZZZ].`);
    return { ok: false, errors, warnings, zoneless: false };
  }
  const [, y, mo, d, h, mi, s, , tz] = m;
  rangeErrors({ y, mo, d, h, mi, s, tz }, errors);
  const zoneless = Boolean(h && !tz);
  if (zoneless) warnings.push("No time zone offset; the receiver will assume the sender's local time.");
  return { ok: errors.length === 0, errors, warnings, zoneless };
}

/** Check a DT value. */
export function checkDate(value) {
  const v = String(value ?? "").trim();
  const errors = [];
  if (!v) return { ok: true, errors };
  const m = DT_RE.exec(v);
  if (!m) errors.push(`'${v}' is not a valid DT. Expected YYYY[MM[DD]].`);
  else rangeErrors({ y: m[1], mo: m[2], d: m[3] }, errors);
  return { ok: errors.length === 0, errors };
}

/** Check a TM value. */
export function checkTime(value) {
  const v = String(value ?? "").trim();
  const errors = [];
  if (!v) return { ok: true, errors };
  const m = TM_RE.exec(v);
  if (!m) errors.push(`'${v}' is not a valid TM. Expected HH[MM[SS[.S[S[S[S]]]]]][+/-ZZZZ].`);
  else rangeErrors({ h: m[1], mi: m[2], s: m[3], tz: m[5] }, errors);
  return { ok: errors.length === 0, errors };
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
