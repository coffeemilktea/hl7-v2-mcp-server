/** generate_ack: build a v2.5.1 ACK (MSH + MSA [+ ERR]) for a received message. */
import { randomBytes } from "crypto";
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY_NON_IDEMPOTENT } from "../result.js";
import { message, out } from "../schemas.js";
import { validateMessage } from "../validate/index.js";

const ERROR_TEXT = Object.fromEntries(core.tableCodes("0357", { status: "valid" }).map((v) => [v.code, v.display]));

/** Map a validator finding to a table 0357 code, or null when no code fits honestly. */
function codeForFinding(msg) {
  if (/is required|is empty|requires (an?|at least)|must identify|neither .* is present/i.test(msg)) return "101";
  if (/not a table|not valid in v2\.5\.1|could not be verified for v2\.5\.1|not a .* value/i.test(msg)) return "103";
  if (/not a valid TS|out of range|not numeric|not a valid DICOM UID|characters; the v2\.5\.1 maximum/i.test(msg)) return "102";
  if (/must immediately follow|appears before|has no place|must not appear|segment\(s\)|appears \d+ times|paired with exactly one/i.test(msg)) return "100";
  return null;
}

/** "PID-3[2].4" / "OBR[2]-25" → ERL components. */
function erl(location, ctx) {
  const m = /^([A-Z][A-Z0-9]{2})(?:\[(\d+)\])?(?:-(\d+))?(?:\[(\d+)\])?(?:\.(\d+))?(?:\.(\d+))?/.exec(String(location ?? ""));
  if (!m) return "";
  const parts = [m[1], m[2] ?? "1", m[3] ?? "", m[4] ?? (m[3] ? "1" : ""), m[5] ?? "", m[6] ?? ""];
  while (parts.length > 2 && !parts[parts.length - 1]) parts.pop();
  return parts.map((p) => core.escape(p, ctx)).join(ctx.compSep);
}

export function buildAck(input) {
  const { message: msg, ackCode, errors = [], fromValidation = false, controlId, timestamp } = input;
  const ctx = core.dissect(msg);
  if (!ctx.lines.length || !ctx.lines[0].startsWith("MSH")) throw new Error("The message must begin with an MSH segment so its header can be acknowledged.");
  const m = core.fielder(ctx.lines[0], ctx.fieldSep);
  const origControl = m(10);
  const trigger = core.comp(m(9), 2, ctx.compSep);
  const notes = [];
  if (!origControl) notes.push("The original MSH-10 is empty, so MSA-2 cannot echo a control id. The sender will not be able to match this ACK.");

  const errs = errors.map((e) => ({ ...e }));
  const unmapped = [];
  let validation = null;
  if (fromValidation) {
    validation = validateMessage(msg);
    for (const f of validation.errors) {
      const code = codeForFinding(f.message);
      if (code) errs.push({ location: f.location, code, severity: "E", diagnostic: f.message });
      else unmapped.push(f);
    }
  }
  const code = ackCode ?? (fromValidation ? (errs.some((e) => (e.severity ?? "E") === "E") ? "AE" : "AA") : "AA");
  if (["AE", "AR", "CE", "CR"].includes(code) && errs.length === 0) {
    notes.push(`${code} without an ERR segment: v2.5.1 expects ERR to explain an error or reject acknowledgment. Pass 'errors' or set fromValidation.`);
  }
  if (["AA", "CA"].includes(code) && errs.some((e) => (e.severity ?? "E") === "E")) {
    notes.push(`Acknowledgment code ${code} (accept) is being sent with error-severity ERR segments; receivers may ignore the ERR. Consider AE.`);
  }
  for (const e of errs) {
    if (!ERROR_TEXT[e.code]) throw new Error(`'${e.code}' is not a table 0357 Message Error Condition code valid in v2.5.1. Valid: ${Object.keys(ERROR_TEXT).join(", ")}.`);
  }

  const enc = m(2) || "^~\\&";
  const out = { ...ctx };
  const ts = timestamp ?? core.nowTs();
  const cid = controlId ?? `ACK${randomBytes(8).toString("hex").toUpperCase()}`.slice(0, 20);
  if (cid.length > 20) throw new Error("controlId must be 20 characters or fewer (MSH-10 maximum length in v2.5.1).");
  const version = m(12) || "2.5.1";
  const msh = core.buildSegment(
    "MSH",
    [ctx.fieldSep, enc, m(5), m(6), m(3), m(4), ts, "", ["ACK", trigger, "ACK"].join(ctx.compSep), cid, m(11), version],
    out
  );
  const msa = core.buildSegment("MSA", [code, origControl], out);
  const errSegs = errs.map((e) =>
    core.buildSegment(
      "ERR",
      [
        "",
        e.location ? erl(e.location, out) : "",
        [e.code, core.escape(ERROR_TEXT[e.code], out), "HL70357"].join(out.compSep),
        e.severity ?? "E",
        "",
        "",
        e.diagnostic ? core.escape(e.diagnostic, out) : "",
        e.userMessage ? core.escape(e.userMessage, out) : "",
      ],
      out
    )
  );
  const segments = [msh, msa, ...errSegs];
  return {
    ack: segments.join("\r"),
    segments,
    acknowledgmentCode: code,
    acknowledges: { controlId: origControl || null, messageType: m(9) || null },
    errCount: errSegs.length,
    ...(unmapped.length ? { unmappedFindings: unmapped } : {}),
    ...(validation ? { validationSummary: validation.counts } : {}),
    notes,
  };
}

export function register(server) {
  server.registerTool(
    "generate_ack",
    {
      title: "Generate an ACK",
      description:
        "Build an HL7 v2.5.1 original-mode acknowledgment for a received message: MSH with sender/receiver swapped and MSH-9 ACK^<trigger>^ACK, MSA echoing MSH-10, and optional ERR segments (table 0357 codes, ERL locations, severity). With fromValidation the message is validated first and its errors become ERR segments.",
      inputSchema: {
        message,
        ackCode: z
          .string()
          .trim()
          .transform((s) => s.toUpperCase())
          .pipe(z.enum(["AA", "AE", "AR", "CA", "CE", "CR"]))
          .optional()
          .describe("MSA-1 (table 0008): AA accept, AE error, AR reject; CA/CE/CR for enhanced-mode commit acks. Default AA, or AE/AA from validation when fromValidation is true."),
        errors: z
          .array(
            z.object({
              location: z.string().optional().describe("Where the error is, e.g. PID-3, OBR[2]-25, PID-3[2].4."),
              code: z.coerce.string().describe("Table 0357 code: 0 accepted, 100 segment sequence, 101 required field missing, 102 data type, 103 table value not found, 200 unsupported message type, 201 unsupported event, 202 unsupported processing id, 203 unsupported version, 204 unknown key, 205 duplicate key, 206 application record locked, 207 application internal error."),
              severity: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.enum(["E", "W", "I"])).optional().describe("ERR-4 (table 0516): E error (default), W warning, I information."),
              diagnostic: z.string().optional().describe("ERR-7 Diagnostic Information."),
              userMessage: z.string().optional().describe("ERR-8 User Message."),
            })
          )
          .optional()
          .describe("ERR segments to include."),
        fromValidation: z.coerce.boolean().default(false).describe("Validate the message and add an ERR for each validation error that maps to a table 0357 code."),
        controlId: z.string().optional().describe("MSH-10 for the ACK (max 20 characters). Default: random."),
        timestamp: z.string().regex(core.TS_RE).optional().describe("MSH-7 for the ACK as an HL7 TS. Default: now, with offset."),
      },
      outputSchema: out({
        ack: z.string(),
        segments: z.array(z.string()),
        acknowledgmentCode: z.string(),
        acknowledges: z.object({ controlId: z.string().nullable(), messageType: z.string().nullable() }),
        errCount: z.number(),
        notes: z.array(z.string()),
      }),
      annotations: { title: "Generate an ACK", ...READ_ONLY_NON_IDEMPOTENT },
    },
    async (input) => {
      try {
        return ok(buildAck(input));
      } catch (err) {
        return fail(err.message);
      }
    }
  );
}
