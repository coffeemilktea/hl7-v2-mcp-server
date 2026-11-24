/**
 * generate_ack: build a v2.5.1 general acknowledgment (ACK: MSH MSA [{ERR}])
 * for a received message.
 *
 * - MSH: sending/receiving application and facility swapped, MSH-9 ACK^<trigger>^ACK,
 *   MSH-11 and MSH-12 echoed, the sender's delimiters reused.
 * - MSA-1 from table 0008, MSA-2 = the original MSH-10.
 * - ERR-2 ERL location, ERR-3 CWE code from table 0357 (^text^HL70357), ERR-4
 *   severity from table 0516, ERR-7/8 diagnostic and user text.
 * - Acknowledgment mode: original (MSH-15/16 empty) uses AA/AE/AR; enhanced
 *   mode (MSH-15 or MSH-16 valued) uses CA/CE/CR for the accept (commit)
 *   acknowledgment and AA/AE/AR for the application acknowledgment.
 */
import { randomBytes } from "crypto";
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY_NON_IDEMPOTENT } from "../result.js";
import { message, out } from "../schemas.js";
import { validateMessage } from "../validate/index.js";

const ERROR_TEXT = Object.fromEntries(core.tableCodes("0357", { status: "valid" }).map((v) => [v.code, v.display]));
/** Table 0357 codes that mean the message cannot be processed at all: AR / CR rather than AE / CE. */
const REJECT_CODES = new Set(["200", "201", "202", "203"]);
const ACK_TYPES = { AL: "always", NE: "never", ER: "only on error", SU: "only on success" };

/** Canonical validator location ("PID-3[2].4", "OBX[2]-5.1", "EVN") → ERL components, or "" when it is not a segment location. */
export function erl(location, ctx) {
  const p = /^([A-Z][A-Z0-9]{2})(?:\[(\d+)\])?(?:-(\d+)(?:\[(\d+)\])?(?:\.(\d+)(?:\.(\d+))?)?)?$/.exec(String(location ?? ""));
  if (!p) return "";
  const parts = [p[1], p[2] ?? "1", p[3] ?? "", p[3] ? p[4] ?? "1" : "", p[5] ?? "", p[6] ?? ""];
  while (parts.length > 2 && !parts[parts.length - 1]) parts.pop();
  return parts.join(ctx.compSep);
}

export function buildAck(input) {
  const { message: msg, ackCode, errors = [], fromValidation = false, controlId, timestamp } = input;
  const ctx = core.dissect(msg);
  if (!ctx.lines.length || !ctx.lines[0].startsWith("MSH") || ctx.lines[0].length < 8) {
    throw new Error("The message must begin with a complete MSH segment (MSH, field separator, encoding characters) so its header can be acknowledged.");
  }
  const m = core.fielder(ctx.lines[0], ctx.fieldSep);
  const msgCode = core.comp(m(9), 1, ctx.compSep).toUpperCase();
  if (msgCode === "ACK") throw new Error("The message is itself an ACK. Acknowledgments are never acknowledged in HL7 v2.");
  const origControl = m(10);
  const trigger = core.comp(m(9), 2, ctx.compSep);
  const accept = core.comp(m(15), 1, ctx.compSep).toUpperCase();
  const application = core.comp(m(16), 1, ctx.compSep).toUpperCase();
  const enhanced = Boolean(accept || application);
  const notes = [];
  if (!origControl) notes.push("The original MSH-10 is empty, so MSA-2 cannot echo a control id and the sender cannot match this ACK.");

  const errs = errors.map((e) => ({ ...e, code: String(e.code), severity: e.severity ?? "E" }));
  for (const e of errs) {
    if (!ERROR_TEXT[e.code]) throw new Error(`'${e.code}' is not a table 0357 Message Error Condition code valid in v2.5.1. Valid: ${Object.keys(ERROR_TEXT).join(", ")}.`);
  }
  const unmapped = [];
  let validation = null;
  if (fromValidation) {
    validation = validateMessage(msg);
    for (const f of validation.errors) {
      if (f.code) errs.push({ location: f.location, code: f.code, severity: "E", diagnostic: f.message });
      else unmapped.push(f);
    }
  }

  const failed = errs.some((e) => e.severity === "E") || (validation && !validation.valid);
  const rejected = errs.some((e) => e.severity === "E" && REJECT_CODES.has(e.code));
  const level = enhanced ? "C" : "A";
  const code = ackCode ?? `${level}${rejected ? "R" : failed ? "E" : "A"}`;

  // Acknowledgment-mode advice (v2.5.1 §2.9).
  if (code.startsWith("C") && !enhanced) {
    notes.push(`${code} is an enhanced-mode accept (commit) code, but MSH-15/16 are empty, so the sender uses original mode and expects AA, AE or AR.`);
  }
  if (enhanced) {
    const requested = code.startsWith("C") ? ["MSH-15 Accept Acknowledgment Type", accept] : ["MSH-16 Application Acknowledgment Type", application];
    const [field, type] = requested;
    const positive = code.endsWith("A");
    if (!type) notes.push(`${field} is empty; in enhanced mode that means the sender did not ask for this acknowledgment.`);
    else if (type === "NE" || (type === "ER" && positive) || (type === "SU" && !positive)) notes.push(`${field} is '${type}' (${ACK_TYPES[type]}), so the sender does not expect this ${code}.`);
    if (!ackCode) notes.push(`Enhanced mode (MSH-15 '${accept || "-"}', MSH-16 '${application || "-"}'): this is the accept acknowledgment (${code}). Pass ackCode AA/AE/AR for the application acknowledgment.`);
  }
  if (["AE", "AR", "CE", "CR"].includes(code) && errs.length === 0) {
    notes.push(`${code} without an ERR segment: add 'errors' (or fromValidation) so the sender learns what was wrong.`);
  }
  if (["AA", "CA"].includes(code) && errs.some((e) => e.severity === "E")) {
    notes.push(`${code} (accept) is being sent with error-severity ERR segments; receivers may ignore them. Consider ${level}E.`);
  }
  const version = m(12) || "2.5.1";
  if (core.comp(version, 1, ctx.compSep) !== "2.5.1") {
    notes.push(`The message is version '${core.comp(version, 1, ctx.compSep)}'. The ACK echoes it in MSH-12; a v2.5.1-only receiver would instead reject with ${level}R and ERR-3 code 203 (unsupported version id).`);
  }

  const cid = controlId ?? `ACK${randomBytes(8).toString("hex").toUpperCase()}`;
  const enc = `${ctx.compSep}${ctx.repSep}${ctx.escChar}${ctx.subSep}`;
  const esc = (s) => core.escape(s, ctx);
  const msh = core.buildSegment(
    "MSH",
    [ctx.fieldSep, enc, m(5), m(6), m(3), m(4), timestamp ?? core.nowTs(), "", ["ACK", trigger, "ACK"].join(ctx.compSep), cid, m(11), version],
    ctx
  );
  const msa = core.buildSegment("MSA", [code, origControl], ctx);
  const errSegs = errs.map((e) =>
    core.buildSegment(
      "ERR",
      ["", e.location ? erl(e.location, ctx) : "", [e.code, esc(ERROR_TEXT[e.code]), "HL70357"].join(ctx.compSep), e.severity, "", "", esc(e.diagnostic ?? ""), esc(e.userMessage ?? "")],
      ctx
    )
  );
  // ACK abstract syntax: MSH [{SFT}] MSA [{ERR}]
  const segments = [msh, msa, ...errSegs];
  return {
    ack: segments.join("\r") + "\r",
    segments,
    acknowledgmentCode: code,
    mode: enhanced ? "enhanced" : "original",
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
        "Build the HL7 v2.5.1 general acknowledgment (ACK) for a received message: MSH with sender/receiver swapped, MSH-9 ACK^<trigger>^ACK, MSA-2 echoing MSH-10, and optional ERR segments (ERR-2 location, ERR-3 table 0357 code, ERR-4 severity). Honours original vs enhanced mode (MSH-15/16). With fromValidation the message is validated first and each error becomes an ERR; unsupported type/event/processing id/version give AR (CR).",
      inputSchema: {
        message,
        ackCode: z
          .string()
          .trim()
          .transform((s) => s.toUpperCase())
          .pipe(z.enum(["AA", "AE", "AR", "CA", "CE", "CR"]))
          .optional()
          .describe("MSA-1 (table 0008). Original mode: AA accept, AE error, AR reject. Enhanced mode accept acks: CA, CE, CR. Default: derived from the mode and the errors."),
        errors: z
          .array(
            z.object({
              location: z.string().optional().describe("Where the error is, e.g. PID-3, OBX[2]-5, PID-3[2].4 (segment[occurrence]-field[repetition].component.subcomponent)."),
              code: z.coerce.string().describe("Table 0357: 0 accepted, 100 segment sequence, 101 required field missing, 102 data type, 103 table value not found, 200 unsupported message type, 201 unsupported event, 202 unsupported processing id, 203 unsupported version, 204 unknown key, 205 duplicate key, 206 record locked, 207 application error."),
              severity: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.enum(["E", "W", "I"])).optional().describe("ERR-4 (table 0516): E error (default), W warning, I information."),
              diagnostic: z.string().max(2048).optional().describe("ERR-7 Diagnostic Information."),
              userMessage: z.string().max(250).optional().describe("ERR-8 User Message."),
            })
          )
          .max(100)
          .optional()
          .describe("ERR segments to include."),
        fromValidation: z.coerce.boolean().default(false).describe("Validate the message and add an ERR for each validation error."),
        controlId: z.string().trim().min(1).max(20).optional().describe("MSH-10 for the ACK (max 20 characters). Default: random."),
        timestamp: z.string().regex(core.TS_RE).optional().describe("MSH-7 for the ACK as an HL7 DTM, e.g. 20261019120500-0700. Default: now, with offset."),
      },
      outputSchema: out({
        ack: z.string(),
        segments: z.array(z.string()),
        acknowledgmentCode: z.string(),
        mode: z.enum(["original", "enhanced"]),
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
