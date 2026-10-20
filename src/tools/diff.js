/** diff_messages: field/component-level comparison of two HL7 v2 messages. */
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY } from "../result.js";
import { offset, limit, page, out } from "../schemas.js";

const DEFAULT_IGNORE = ["MSH-7", "MSH-10"];

function occurrences(parsed) {
  const counts = {};
  return parsed.segments.map((s) => {
    counts[s.name] = (counts[s.name] ?? 0) + 1;
    return { key: `${s.name}[${counts[s.name]}]`, seg: s, occ: counts[s.name] };
  });
}

function fieldName(seg, seq) {
  return core.getField(seg, seq)?.name ?? null;
}

/** Compare one field; returns differences at component (or subcomponent) level. */
function diffField(segName, occ, seq, a, b, level, multi) {
  const loc = (rep, c, s) =>
    `${segName}${multi ? `[${occ}]` : ""}-${seq}${rep !== undefined && rep > 0 ? `[${rep + 1}]` : ""}${c !== undefined ? `.${c + 1}` : ""}${s !== undefined ? `.${s + 1}` : ""}`;
  if ((a?.raw ?? "") === (b?.raw ?? "")) return [];
  if (level === "field" || !a || !b || a.raw === "" || b.raw === "" || (segName === "MSH" && seq <= 2)) {
    return [{ location: loc(), left: a?.raw ?? "", right: b?.raw ?? "" }];
  }
  const out = [];
  const nr = Math.max(a.reps.length, b.reps.length);
  for (let r = 0; r < nr; r++) {
    const ra = a.reps[r] ?? [];
    const rb = b.reps[r] ?? [];
    const nc = Math.max(ra.length, rb.length);
    for (let c = 0; c < nc; c++) {
      const ca = ra[c] ?? [""];
      const cb = rb[c] ?? [""];
      const ja = ca.join("&");
      const jb = cb.join("&");
      if (ja === jb) continue;
      if (level === "subcomponent" && (ca.length > 1 || cb.length > 1)) {
        const ns = Math.max(ca.length, cb.length);
        for (let s = 0; s < ns; s++) if ((ca[s] ?? "") !== (cb[s] ?? "")) out.push({ location: loc(r, c, s), left: ca[s] ?? "", right: cb[s] ?? "" });
      } else out.push({ location: loc(r, c), left: ca.length > 1 ? ca : ca[0], right: cb.length > 1 ? cb : cb[0] });
    }
  }
  return out;
}

export function diffMessages({ left, right, ignore = DEFAULT_IGNORE, level = "component" }) {
  const pa = core.parseMessage(left);
  const pb = core.parseMessage(right);
  const ign = ignore.map((p) => {
    const pp = core.parsePath(p);
    if (!pp) throw new Error(`Invalid ignore path '${p}'. Use e.g. MSH-7, PID-3 or OBX.`);
    return pp;
  });
  const ignored = (seg, seq) => ign.some((p) => p.segment === seg && (p.field === undefined || p.field === seq));
  const oa = occurrences(pa);
  const ob = occurrences(pb);
  const mapB = new Map(ob.map((o) => [o.key, o]));
  const mapA = new Map(oa.map((o) => [o.key, o]));
  const countOf = (arr, name) => arr.filter((o) => o.seg.name === name).length;
  const differences = [];
  const segmentChanges = [];
  for (const o of oa) {
    const other = mapB.get(o.key);
    if (!other) {
      segmentChanges.push({ change: "removed", segment: o.key, line: o.seg.line });
      continue;
    }
    if (ignored(o.seg.name, undefined)) continue;
    const multi = countOf(oa, o.seg.name) > 1 || countOf(ob, o.seg.name) > 1;
    const n = Math.max(o.seg.fields.length, other.seg.fields.length);
    for (let i = 0; i < n; i++) {
      const fa = o.seg.fields[i];
      const fb = other.seg.fields[i];
      const seq = (fa ?? fb).seq;
      if (ignored(o.seg.name, seq)) continue;
      for (const d of diffField(o.seg.name, o.occ, seq, fa, fb, level, multi)) {
        const change = (fa?.raw ?? "") === "" ? "added" : (fb?.raw ?? "") === "" ? "removed" : "changed";
        differences.push({ ...d, fieldName: fieldName(o.seg.name, seq), change });
      }
    }
  }
  for (const o of ob) if (!mapA.has(o.key)) segmentChanges.push({ change: "added", segment: o.key, line: o.seg.line });
  // Relative order of the segments both messages share.
  const shared = (from, other) => from.filter((o) => other.has(o.key)).map((o) => o.key).join(" ");
  const orderA = shared(oa, mapB);
  const orderB = shared(ob, mapA);
  return {
    identical: differences.length === 0 && segmentChanges.length === 0,
    ignored: ignore,
    segmentOrderChanged: orderA !== orderB,
    segmentChanges,
    differences,
    counts: { segmentChanges: segmentChanges.length, fieldDifferences: differences.length },
    ...(pa.delimiters.compSep !== pb.delimiters.compSep || pa.delimiters.fieldSep !== pb.delimiters.fieldSep
      ? { note: "The messages use different delimiters; values were compared after decoding." }
      : {}),
  };
}

export function register(server) {
  server.registerTool(
    "diff_messages",
    {
      title: "Diff two HL7 v2 messages",
      description:
        "Compare two HL7 v2 messages segment by segment (matched by segment type and occurrence) and report added/removed segments and field, component or subcomponent differences with v2.5.1 field names. MSH-7 and MSH-10 are ignored by default. Values are compared after decoding escapes.",
      inputSchema: {
        left: z.string().min(1).describe("The first (e.g. expected or before) message."),
        right: z.string().min(1).describe("The second (e.g. actual or after) message."),
        ignore: z
          .array(z.string())
          .default(DEFAULT_IGNORE)
          .describe("Fields or whole segments to ignore, e.g. ['MSH-7','MSH-10','EVN']. Default ['MSH-7','MSH-10']; pass [] to compare everything."),
        level: z.enum(["field", "component", "subcomponent"]).default("component").describe("Granularity of differences. Default component."),
        offset,
        limit: limit(200, 1000),
      },
      outputSchema: out({
        identical: z.boolean(),
        ignored: z.array(z.string()),
        segmentOrderChanged: z.boolean(),
        segmentChanges: z.array(z.object({ change: z.string(), segment: z.string(), line: z.string() })),
        ...page.shape,
        differences: z.array(z.object({ location: z.string(), change: z.string(), fieldName: z.string().nullable(), left: z.any(), right: z.any() })),
        counts: z.object({ segmentChanges: z.number(), fieldDifferences: z.number() }),
      }),
      annotations: { title: "Diff two HL7 v2 messages", ...READ_ONLY },
    },
    async ({ left, right, ignore, level, offset, limit }) => {
      let res;
      try {
        res = diffMessages({ left, right, ignore, level });
      } catch (err) {
        return fail(`Cannot diff: ${err.message}`);
      }
      const p = core.paginate(res.differences, offset, limit);
      return ok({ ...res, total: p.total, offset: p.offset, limit: p.limit, nextOffset: p.nextOffset, differences: p.items });
    }
  );
}
