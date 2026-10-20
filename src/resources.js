/** MCP resources: read-only views of the reference data by URI. */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as core from "hl7v2-core";

const json = (uri, data) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] });

export function register(server) {
  server.registerResource(
    "segment",
    new ResourceTemplate("hl7v2://segment/{code}", { list: undefined }),
    { title: "HL7 v2.5.1 segment", description: "Segment definition, e.g. hl7v2://segment/PID", mimeType: "application/json" },
    async (uri, { code }) => {
      const s = core.getSegment(code);
      if (!s) throw new Error(`Segment '${code}' not found in HL7 v2.5.1.`);
      return json(uri, s);
    }
  );
  server.registerResource(
    "datatype",
    new ResourceTemplate("hl7v2://datatype/{code}", { list: undefined }),
    { title: "HL7 v2.5.1 data type", description: "Data type definition, e.g. hl7v2://datatype/CX", mimeType: "application/json" },
    async (uri, { code }) => {
      const d = core.getDatatype(code);
      if (!d) throw new Error(`Data type '${code}' not found in HL7 v2.5.1.`);
      return json(uri, d);
    }
  );
  server.registerResource(
    "table",
    new ResourceTemplate("hl7v2://table/{id}", { list: undefined }),
    { title: "HL7 v2.5.1 table", description: "Code table with per-code v2.5.1 status, e.g. hl7v2://table/0004", mimeType: "application/json" },
    async (uri, { id }) => {
      const t = core.getTable(id);
      if (!t) throw new Error(`Table '${id}' not found.`);
      return json(uri, t);
    }
  );
  server.registerResource(
    "structure",
    new ResourceTemplate("hl7v2://structure/{id}", { list: undefined }),
    { title: "HL7 v2.5.1 message structure", description: "Abstract message syntax, e.g. hl7v2://structure/ORU_R01", mimeType: "application/json" },
    async (uri, { id }) => {
      const r = core.getStructure(id);
      if (!r) throw new Error(`Structure '${id}' not found.`);
      return json(uri, r.structure);
    }
  );
  server.registerResource(
    "sources",
    "hl7v2://about/sources",
    { title: "Data sources and licences", description: "Where the reference data comes from, with licences and counts.", mimeType: "application/json" },
    async (uri) => json(uri, core.meta())
  );
}
