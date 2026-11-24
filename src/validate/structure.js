/**
 * Segment-sequence check against the v2.5.1 abstract message syntax
 * (groups, optional [ ], repeating { }, choice < | >).
 *
 * The matcher computes every position a node can end at (so ambiguous
 * structures such as NTE or OBX appearing in several groups are handled
 * without guessing), records the furthest point any parse reached, and
 * reports the first segment that cannot be placed. It then recovers by
 * skipping that segment (or assuming a missing one) to find further problems.
 * Z-segments and segments unknown to v2.5.1 are skipped: local segments may
 * appear anywhere by convention and unknown ones are reported separately.
 */
import { getSegment } from "hl7v2-core";
import { E } from "./report.js";

const MAX_ISSUES = 5;

function namesIn(nodes, out = new Set()) {
  for (const n of nodes) {
    if (n.segment) out.add(n.segment);
    if (n.choice) n.choice.forEach((c) => out.add(c.segment));
    if (n.children) namesIn(n.children, out);
  }
  return out;
}

/** Match a sequence of segment names. Returns { complete, max, expected: Set at max }. */
function run(structure, names) {
  let max = 0;
  const expected = new Map();
  const ids = new Map();
  const memo = new Map();
  const idOf = (n) => ids.get(n) ?? (ids.set(n, ids.size), ids.size - 1);
  const miss = (p, name) => (expected.get(p) ?? expected.set(p, new Set()).get(p)).add(name);
  const seg = (name, p) => {
    if (names[p] === name) {
      if (p + 1 > max) max = p + 1;
      return [p + 1];
    }
    miss(p, name);
    return [];
  };
  const once = (n, p) => {
    if (n.segment) return seg(n.segment, p);
    if (n.choice) return n.choice.flatMap((c) => seg(c.segment, p));
    return [...list(n.children, p)];
  };
  const occurs = (n, p) => {
    const key = `${idOf(n)}@${p}`;
    if (memo.has(key)) return memo.get(key);
    const ends = new Set(n.required ? [] : [p]);
    let frontier = once(n, p).filter((q) => q > p);
    while (frontier.length) {
      const next = [];
      for (const q of frontier) {
        if (ends.has(q)) continue;
        ends.add(q);
        if (n.repeating) for (const r of once(n, q)) if (r > q && !ends.has(r)) next.push(r);
      }
      frontier = next;
    }
    memo.set(key, ends);
    return ends;
  };
  function list(nodes, p) {
    let cur = new Set([p]);
    for (const n of nodes) {
      const next = new Set();
      for (const q of cur) for (const r of occurs(n, q)) next.add(r);
      cur = next;
      if (!cur.size) break;
    }
    return cur;
  }
  const ends = list(structure.segments, 0);
  return { complete: ends.has(names.length), max, expected: expected.get(max) ?? new Set() };
}

export function checkStructure(ctx, r, structure) {
  const all = namesIn(structure.segments);
  let segs = ctx.segs.filter((s) => !s.name.startsWith("Z") && getSegment(s.name));
  const id = structure.id;
  for (let issues = 0; issues < MAX_ISSUES; issues++) {
    const names = segs.map((s) => s.name);
    const res = run(structure, names);
    if (res.complete) return;
    const expected = [...res.expected];
    // Which expected segment, if inserted here, would let the rest of the message parse?
    const fixes = expected.filter((x) => run(structure, [...names.slice(0, res.max), x, ...names.slice(res.max)]).complete);
    const bad = segs[res.max];
    if (fixes.length) {
      const where = bad ? `before ${bad.tag}` : "at the end of the message";
      r.err(fixes.length === 1 ? fixes[0] : bad?.tag ?? "message", `Required ${fixes.join(" or ")} is missing ${where} (${id}).`, E.SEQUENCE);
      segs = [...segs.slice(0, res.max), { name: fixes[0], tag: fixes[0] }, ...segs.slice(res.max)];
    } else if (bad) {
      const hint = expected.length ? `; expected ${expected.slice(0, 8).join(", ")} at this point` : "";
      r.err(bad.tag, all.has(bad.name) ? `${bad.name} is out of sequence for ${id}${hint}.` : `${bad.name} is not part of the ${id} message structure in v2.5.1.`, E.SEQUENCE);
      segs = segs.filter((_, i) => i !== res.max);
    } else {
      r.err("message", `The message ends before the ${id} structure is complete; expected ${expected.slice(0, 8).join(", ")}.`, E.SEQUENCE);
      return;
    }
  }
}
