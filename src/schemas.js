/**
 * Shared, lenient input schemas. Models often send numbers as strings, table
 * ids without leading zeros or message types in lower case; accept them.
 */
import { z } from "zod";

/** Largest message accepted (characters). Large enough for embedded reports, small enough to bound work. */
export const MAX_MESSAGE_CHARS = 1_000_000;

export const message = z
  .string()
  .refine((s) => s.trim().length > 0, "The message is empty.")
  .refine((s) => s.length <= MAX_MESSAGE_CHARS, `The message is over ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`)
  .describe("One HL7 v2 message, starting with MSH. Segments may end in \\r, \\n or \\r\\n; MLLP framing (0x0B ... 0x1C 0x0D) is stripped.");

export const segmentCode = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.toUpperCase())
  .describe("Three-character segment code, e.g. MSH, PID, OBR, OBX, ZDS. Case-insensitive.");

export const offset = z.coerce.number().int().min(0).default(0).describe("Index of the first item to return (pagination). Default 0.");
export const limit = (def, max) =>
  z.coerce.number().int().min(1).max(max).default(def).describe(`Maximum items to return (1–${max}). Default ${def}.`);

/** Pagination block every list result includes. */
export const page = z.object({
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  nextOffset: z.number().int().nullable(),
});

export const issue = z.object({
  location: z.string(),
  message: z.string(),
  code: z.string().optional().describe("HL7 table 0357 error condition (errors only), as used in ERR-3."),
});

/**
 * Output schema helper: an object schema that allows extra keys, so optional
 * informational fields do not break clients that validate structuredContent.
 */
export const out = (shape) => z.object(shape).passthrough();

/** Boolean that also accepts "true"/"false" strings (z.coerce.boolean() turns "false" into true). */
export const bool = (def) =>
  z.preprocess((v) => (typeof v === "string" ? ({ true: true, false: false }[v.trim().toLowerCase()] ?? v) : v), z.boolean()).default(def);
