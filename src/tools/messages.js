/** Message tools: parse_message and validate_message. */
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY } from "../result.js";
import { message, offset, limit, page, issue, out } from "../schemas.js";
import { validateMessage, PROFILES } from "../validate/index.js";

/** Collapse [rep][comp][sub] to the most compact JSON form (string when trivial). */
function compact(reps) {
  const r = reps.map((rep) => {
    const comps = rep.map((subs) => (subs.length === 1 ? subs[0] : subs));
    return comps.length === 1 ? comps[0] : comps;
  });
  return r.length === 1 ? r[0] : r;
}

export function summarize(parsed) {
  const raw = (path) => {
    const p = core.parsePath(path);
    const seg = parsed.segments.filter((s) => s.name === p.segment)[0];
    const f = seg?.fields.find((x) => x.seq === p.field);
    return f && f.raw !== "" ? f.raw : null;
  };
  const val = (path) => core.getValue(parsed, path) || null;
  const accCandidates = [
    ["OBR-18", raw("OBR-18")],
    ["IPC-1", val("IPC-1.1")],
    ["OBR-3", raw("OBR-3")],
    ["ORC-3", raw("ORC-3")],
  ].filter(([, v]) => v);
  const [accessionSource, accession] = accCandidates[0] ?? [null, null];
  return {
    messageType: raw("MSH-9"),
    controlId: val("MSH-10"),
    sendingApp: raw("MSH-3"),
    sendingFacility: raw("MSH-4"),
    receivingApp: raw("MSH-5"),
    dateTime: val("MSH-7.1"),
    version: val("MSH-12.1"),
    patientId: raw("PID-3"),
    patientName: raw("PID-5"),
    priorPatientId: raw("MRG-1"),
    orderControl: val("ORC-1"),
    accession: accession ?? null,
    accessionSource,
    studyInstanceUid: val("IPC-3.1") ?? val("ZDS-1.1"),
    resultStatus: val("OBR-25"),
    segmentCount: parsed.segments.length,
    segments: parsed.segments.map((s) => s.name),
  };
}

export function register(server) {
  server.registerTool(
    "parse_message",
    {
      title: "Parse an HL7 v2 message",
      description:
        "Parse an HL7 v2.x message into JSON: a summary (type, control id, patient, accession, status) and every segment's fields labelled with v2.5.1 field names. Escape sequences are decoded. Use `segments` and offset/limit for large messages.",
      inputSchema: {
        message,
        segments: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(/[,\s]+/)).map((s) => s.trim().toUpperCase()).filter(Boolean)))
          .describe("Only return these segment types, e.g. ['PID','OBX'] or 'PID,OBX'."),
        includeEmpty: z.coerce.boolean().default(false).describe("Include empty fields. Default false."),
        offset,
        limit: limit(100, 1000),
      },
      outputSchema: out({
        summary: z.record(z.string(), z.any()),
        delimiters: z.record(z.string(), z.string()),
        ...page.shape,
        parsedSegments: z.array(z.object({ segment: z.string(), index: z.number(), fields: z.record(z.string(), z.any()) })),
      }),
      annotations: { title: "Parse an HL7 v2 message", ...READ_ONLY },
    },
    async ({ message, segments, includeEmpty, offset, limit }) => {
      let parsed;
      try {
        parsed = core.parseMessage(message);
      } catch (err) {
        return fail(`Parse error: ${err.message}`);
      }
      const chosen = parsed.segments.filter((s) => !segments?.length || segments.includes(s.name));
      const p = core.paginate(chosen, offset, limit);
      const out = p.items.map((s) => {
        const def = core.getSegment(s.name);
        const fields = {};
        for (const f of s.fields) {
          if (!includeEmpty && f.raw === "") continue;
          const fd = def?.fields.find((x) => x.seq === f.seq);
          fields[`${s.name}-${f.seq}${fd ? ` (${fd.name})` : ""}`] = f.seq <= 2 && s.name === "MSH" ? f.raw : compact(f.reps);
        }
        return { segment: s.name, index: s.index, fields };
      });
      return ok(
        {
          summary: summarize(parsed),
          delimiters: parsed.delimiters,
          total: p.total,
          offset: p.offset,
          limit: p.limit,
          nextOffset: p.nextOffset,
          parsedSegments: out,
        },
        { hint: "Use the `segments` filter or a smaller `limit` and page with `offset`." }
      );
    }
  );

  server.registerTool(
    "validate_message",
    {
      title: "Validate an HL7 v2.5.1 message",
      description: `Validate an HL7 v2.5.1 message. Base MSH and structural checks run on any message (including message type, trigger and structure against v2.5.1 tables 0076/0003/0354). Deep profiles add required-field, code-table, timestamp, identifier and cross-segment checks for: ${Object.keys(PROFILES).join(", ")}. Codes from later HL7 versions are reported as errors; codes that cannot be verified for v2.5.1 as warnings.`,
      inputSchema: { message },
      outputSchema: out({
        valid: z.boolean(),
        messageType: z.string().nullable(),
        messageStructure: z.string().nullable(),
        version: z.string().nullable(),
        profileApplied: z.string(),
        counts: z.object({ errors: z.number(), warnings: z.number(), info: z.number() }),
        errors: z.array(issue),
        warnings: z.array(issue),
        info: z.array(issue),
        segmentsFound: z.array(z.string()),
      }),
      annotations: { title: "Validate an HL7 v2.5.1 message", ...READ_ONLY },
    },
    async ({ message }) => ok(validateMessage(message))
  );
}
