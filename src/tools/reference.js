/** Reference-data tools: segments, fields, datatypes, events, structures, tables, search. */
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY } from "../result.js";
import { segmentCode, offset, limit, page, out } from "../schemas.js";

const OPT = { R: "Required", O: "Optional", C: "Conditional", B: "Backward compatibility only", W: "Withdrawn", X: "Not supported" };

function fieldView(code, f, { descriptions = true } = {}) {
  const t = f.table ? core.getTable(f.table) : null;
  return {
    location: `${code}-${f.seq}`,
    seq: f.seq,
    name: f.name,
    dataType: f.type,
    optionality: f.opt,
    optionalityLabel: OPT[f.opt] ?? f.opt,
    repeating: f.rpt === "*" ? "unbounded" : f.rpt > 1 ? `up to ${f.rpt}` : "no",
    maxLength: f.len,
    table: f.table ? { id: f.table, name: t?.name ?? null, type: t?.type ?? null, ...(f.src?.table && f.src.table !== "HAPI" ? { bindingSource: f.src.table } : {}) } : null,
    ...(f.tableCandidates ? { tableCandidates: f.tableCandidates } : {}),
    ...(descriptions && f.desc ? { notes: f.desc } : {}),
  };
}

const notFound = (what, value, suggestions) =>
  fail(`${what} '${value}' not found in HL7 v2.5.1.${suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""} Use search_definitions to look it up by name.`);

function suggest(query, kinds) {
  try {
    return core.search(String(query), { kinds, limit: 5 }).items.map((i) => i.id);
  } catch {
    return [];
  }
}

export function register(server) {
  server.registerTool(
    "list_segments",
    {
      title: "List HL7 v2.5.1 segments",
      description:
        "List the segments defined in HL7 v2.5.1 (149 standard segments plus curated Z-segments such as ZDS), with field counts. Paginated; filter by code or name.",
      inputSchema: {
        filter: z.string().optional().describe("Case-insensitive match on segment code or name, e.g. 'order' or 'PV'."),
        offset,
        limit: limit(50, 200),
      },
      outputSchema: out({
        standard: z.string(),
        ...page.shape,
        segments: z.array(z.object({ code: z.string(), name: z.string().nullable(), fieldCount: z.number(), hasCuratedNotes: z.boolean(), zSegment: z.boolean() })),
      }),
      annotations: { title: "List HL7 v2.5.1 segments", ...READ_ONLY },
    },
    async ({ filter, offset, limit }) => {
      const q = (filter ?? "").trim().toLowerCase();
      const all = Object.values(core.segments())
        .filter((s) => !q || s.code.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q))
        .map((s) => ({ code: s.code, name: s.name ?? null, fieldCount: s.fields.length, hasCuratedNotes: Boolean(s.description || s.fields.some((f) => f.desc)), zSegment: s.code.startsWith("Z") }));
      const p = core.paginate(all, offset, limit);
      return ok({ standard: "HL7 v2.5.1", total: p.total, offset: p.offset, limit: p.limit, nextOffset: p.nextOffset, segments: p.items });
    }
  );

  server.registerTool(
    "get_segment",
    {
      title: "Get segment definition",
      description:
        "Full HL7 v2.5.1 definition of one segment: every field with data type, optionality (R/O/C/B/W), repetition, length, bound table and curated implementation notes.",
      inputSchema: {
        segment: segmentCode,
        includeNotes: z.coerce.boolean().default(true).describe("Include curated implementation notes per field. Default true."),
      },
      outputSchema: out({
        code: z.string(),
        name: z.string().nullable(),
        description: z.string().nullable(),
        zSegment: z.boolean(),
        fieldCount: z.number(),
        fields: z.array(z.object({ location: z.string(), name: z.string() }).passthrough()),
        source: z.string(),
      }),
      annotations: { title: "Get segment definition", ...READ_ONLY },
    },
    async ({ segment, includeNotes }) => {
      const s = core.getSegment(segment);
      if (!s) return notFound("Segment", segment, suggest(segment, ["segment"]));
      return ok({
        code: s.code,
        name: s.name ?? null,
        description: s.description ?? null,
        zSegment: s.code.startsWith("Z"),
        fieldCount: s.fields.length,
        fields: s.fields.map((f) => fieldView(s.code, f, { descriptions: includeNotes })),
        source: s.src?.structure ?? "unknown",
      });
    }
  );

  server.registerTool(
    "get_field",
    {
      title: "Get field definition",
      description:
        "Definition of one HL7 v2.5.1 field (e.g. PID-3): data type with its components, optionality, repetition, length, bound table (with the count of codes valid in v2.5.1) and curated notes.",
      inputSchema: {
        segment: segmentCode,
        field: z.coerce.number().int().positive().describe("Field sequence number, e.g. 3 for PID-3."),
      },
      outputSchema: out({
        location: z.string(),
        name: z.string(),
        dataType: z.string().nullable(),
        optionality: z.string(),
        components: z.array(z.object({ seq: z.number(), name: z.string().nullable(), type: z.string() }).passthrough()).nullable(),
        tableSummary: z.object({ id: z.string(), name: z.string().nullable(), validCodes: z.number(), otherCodes: z.number() }).nullable(),
        provenance: z.record(z.string(), z.any()),
      }),
      annotations: { title: "Get field definition", ...READ_ONLY },
    },
    async ({ segment, field }) => {
      const s = core.getSegment(segment);
      if (!s) return notFound("Segment", segment, suggest(segment, ["segment"]));
      const f = s.fields.find((x) => x.seq === field);
      if (!f) return fail(`Field ${s.code}-${field} does not exist in v2.5.1. ${s.code} has fields 1–${s.fields.length}.`);
      const dt = f.type ? core.getDatatype(f.type) : null;
      const t = f.table ? core.getTable(f.table) : null;
      return ok({
        ...fieldView(s.code, f),
        dataTypeName: dt?.name ?? null,
        components: dt?.components?.length ? dt.components.map((c) => ({ seq: c.seq, name: c.name, type: c.type, ...(c.table ? { table: c.table } : {}) })) : null,
        tableSummary: t
          ? { id: t.id, name: t.name, validCodes: t.values.filter((v) => v.status === "valid").length, otherCodes: t.values.filter((v) => v.status !== "valid").length }
          : null,
        provenance: f.src ?? {},
      });
    }
  );

  server.registerTool(
    "get_datatype",
    {
      title: "Get data type definition",
      description:
        "Definition of an HL7 v2.5.1 data type (e.g. CX, XPN, TS, CE, HD): its components with their types and tables, and a sample of fields that use it.",
      inputSchema: {
        datatype: z.string().trim().min(1).transform((s) => s.toUpperCase()).describe("Data type code, e.g. CX, XPN, XAD, TS, CE, EI. Case-insensitive."),
        usageLimit: z.coerce.number().int().min(0).max(200).default(25).describe("How many fields that use this type to list (0–200). Default 25."),
      },
      outputSchema: out({
        code: z.string(),
        name: z.string().nullable(),
        kind: z.string(),
        components: z.array(z.object({ seq: z.number(), name: z.string().nullable(), type: z.string() }).passthrough()),
        usedByCount: z.number(),
        usedBy: z.array(z.string()),
      }),
      annotations: { title: "Get data type definition", ...READ_ONLY },
    },
    async ({ datatype, usageLimit }) => {
      const d = core.getDatatype(datatype);
      if (!d) return notFound("Data type", datatype, suggest(datatype, ["datatype"]));
      const users = [];
      for (const s of Object.values(core.segments())) for (const f of s.fields) if (f.type === d.code) users.push(`${s.code}-${f.seq} ${f.name}`);
      const asComponent = [];
      for (const o of Object.values(core.datatypes())) for (const c of o.components) if (c.type === d.code) asComponent.push(`${o.code}.${c.seq} ${c.name ?? ""}`.trim());
      return ok({
        code: d.code,
        name: d.name,
        kind: d.kind,
        components: d.components.map((c) => ({ seq: c.seq, name: c.name, type: c.type, ...(c.table ? { table: c.table } : {}), ...(c.tableSource ? { tableSource: c.tableSource } : {}) })),
        usedByCount: users.length,
        usedBy: users.slice(0, usageLimit),
        usedAsComponentOf: asComponent.slice(0, usageLimit),
        ...(d.table0440 ? { table0440: d.table0440 } : {}),
      });
    }
  );

  server.registerTool(
    "list_message_types",
    {
      title: "List message types and trigger events",
      description:
        "List HL7 v2.5.1 message type/trigger event pairs (e.g. ADT^A04) with the message structure each uses. Paginated; filter by message type, event or text.",
      inputSchema: {
        filter: z.string().optional().describe("Case-insensitive match on the event key, structure or description, e.g. 'ADT', 'O2', 'merge'."),
        offset,
        limit: limit(100, 400),
      },
      outputSchema: out({
        ...page.shape,
        messageTypes: z.array(z.object({ type: z.string(), structure: z.string().nullable(), description: z.string().nullable() }).passthrough()),
      }),
      annotations: { title: "List message types and trigger events", ...READ_ONLY },
    },
    async ({ filter, offset, limit }) => {
      const q = (filter ?? "").trim().toLowerCase();
      const all = Object.entries(core.events())
        .map(([type, e]) => ({
          type,
          structure: e.structure ?? null,
          description: e.curated?.description ?? e.description ?? null,
          verifiedIn251: e.table0003 ? e.table0003.status === "valid" : null,
          hasCuratedNotes: Boolean(e.curated?.notes),
        }))
        .filter((e) => !q || [e.type, e.structure, e.description].some((x) => (x ?? "").toLowerCase().includes(q)));
      const p = core.paginate(all, offset, limit);
      return ok({ total: p.total, offset: p.offset, limit: p.limit, nextOffset: p.nextOffset, messageTypes: p.items });
    }
  );

  server.registerTool(
    "get_message_structure",
    {
      title: "Get message structure",
      description:
        "The v2.5.1 abstract message syntax for a message type/event (e.g. ADT^A04, ORU^R01, ACK) or structure id (e.g. ADT_A01): segment groups, required/optional and repeating segments, plus curated notes.",
      inputSchema: {
        messageType: z.string().trim().min(1).describe("Message type and event (ADT^A04, adt_a04 and 'ADT A04' all work), ACK, or a structure id such as ORU_R01."),
      },
      outputSchema: out({
        messageType: z.string(),
        structure: z.string(),
        abstractSyntax: z.string().nullable(),
        segments: z.array(z.any()),
        eventsUsingStructure: z.array(z.string()),
      }),
      annotations: { title: "Get message structure", ...READ_ONLY },
    },
    async ({ messageType }) => {
      const res = core.getStructure(messageType);
      if (!res) return notFound("Message type or structure", messageType, suggest(messageType, ["event", "structure"]));
      const { structure: s, event: ev } = res;
      const evs = Object.entries(core.events())
        .filter(([, e]) => e.structure === s.id)
        .map(([k]) => k);
      return ok({
        messageType: ev ? (ev.event ? `${ev.messageType}^${ev.event}` : ev.messageType) : s.id,
        structure: s.id,
        description: ev?.curated?.description ?? ev?.description ?? s.description ?? null,
        notes: ev?.curated?.notes ?? null,
        chapter: s.chapter ?? null,
        abstractSyntax: s.abstractSyntax ?? null,
        segments: s.segments,
        eventsUsingStructure: evs,
        verifiedIn251: s.table0354 ? s.table0354.status === "valid" : null,
      });
    }
  );

  server.registerTool(
    "lookup_code_table",
    {
      title: "Look up an HL7 table",
      description:
        "Values of an HL7 v2.5.1 code table (e.g. 0001, 0004, 0119, 0123). By default only codes verified as valid in v2.5.1 are returned; codes from later versions or that cannot be verified are listed only on request and are always labelled.",
      inputSchema: {
        tableNumber: z.union([z.string(), z.number()]).transform((v) => core.normalizeTableId(v)).describe("Table number: '0001', '1', 1 and 'HL70001' all work."),
        filter: z.string().optional().describe("Case-insensitive match on code or display text."),
        status: z
          .enum(["valid", "not-in-2.5.1", "unverified", "all"])
          .default("valid")
          .describe("Which codes to return: 'valid' (verified for v2.5.1, default), 'not-in-2.5.1', 'unverified', or 'all'."),
        offset,
        limit: limit(100, 500),
      },
      outputSchema: out({
        tableNumber: z.string(),
        name: z.string().nullable(),
        type: z.string().nullable(),
        counts: z.object({ valid: z.number(), notIn251: z.number(), unverified: z.number() }),
        ...page.shape,
        values: z.array(z.object({ code: z.string(), display: z.string().nullable(), status: z.string() }).passthrough()),
      }),
      annotations: { title: "Look up an HL7 table", ...READ_ONLY },
    },
    async ({ tableNumber, filter, status, offset, limit }) => {
      const t = core.getTable(tableNumber);
      if (!t) return notFound("Table", tableNumber, suggest(tableNumber, ["table"]));
      const q = (filter ?? "").trim().toLowerCase();
      const vals = t.values
        .filter((v) => status === "all" || v.status === status)
        .filter((v) => !q || v.code.toLowerCase().includes(q) || (v.display ?? "").toLowerCase().includes(q) || (v.note ?? "").toLowerCase().includes(q))
        .map((v) => ({ code: v.code, display: v.display, status: v.status, ...(v.history ? { history: v.history } : {}), ...(v.reason ? { reason: v.reason } : {}), ...(v.note ? { notes: v.note } : {}), ...(v.definition ? { definition: v.definition } : {}) }));
      const p = core.paginate(vals, offset, limit);
      const counts = {
        valid: t.values.filter((v) => v.status === "valid").length,
        notIn251: t.values.filter((v) => v.status === "not-in-2.5.1").length,
        unverified: t.values.filter((v) => v.status === "unverified").length,
      };
      return ok({
        tableNumber: t.id,
        name: t.name,
        type: t.type,
        ...(t.type === "User" ? { userTableNote: "User-defined table: HL7 suggests values, sites may define their own." } : {}),
        whereUsed: t.whereUsed ?? null,
        counts,
        ...(t.values.length === 0 ? { emptyNote: "HL7 publishes no values for this table in v2.5.1 (typically a User table defined locally)." } : {}),
        total: p.total,
        offset: p.offset,
        limit: p.limit,
        nextOffset: p.nextOffset,
        values: p.items,
      });
    }
  );

  server.registerTool(
    "search_definitions",
    {
      title: "Search HL7 v2.5.1 definitions",
      description:
        "Full-text search across HL7 v2.5.1 segments, fields, data types, message events, structures, tables and table codes. Every word must match. Use it when you know a concept ('accession', 'discharge date', 'marital') but not where it lives.",
      inputSchema: {
        query: z.string().trim().min(1).describe("Words to search for, e.g. 'accession number' or 'patient class'."),
        kinds: z
          .array(z.enum(["segment", "field", "datatype", "event", "structure", "table", "code"]))
          .optional()
          .describe("Restrict to these kinds of definition. Default: all."),
        offset,
        limit: limit(25, 100),
      },
      outputSchema: out({
        query: z.string(),
        ...page.shape,
        results: z.array(z.object({ kind: z.string(), id: z.string(), title: z.string() }).passthrough()),
      }),
      annotations: { title: "Search HL7 v2.5.1 definitions", ...READ_ONLY },
    },
    async ({ query, kinds, offset, limit }) => {
      const res = core.search(query, { kinds, offset, limit });
      return ok({ query, total: res.total, offset: res.offset, limit: res.limit, nextOffset: res.nextOffset, results: res.items });
    }
  );
}
