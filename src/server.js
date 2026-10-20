/** Build the MCP server: tools and resources over the shared hl7v2-core data. */
import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as reference from "./tools/reference.js";
import * as messages from "./tools/messages.js";
import * as resources from "./resources.js";

const pkg = createRequire(import.meta.url)("../package.json");
export const SERVER_NAME = "hl7-v251-reference";
export const VERSION = pkg.version;

export function createServer() {
  const server = new McpServer(
    { name: SERVER_NAME, title: "HL7 v2.5.1 Reference", version: VERSION },
    {
      instructions:
        "HL7 v2.5.1 reference and message tools. Look up segments, fields, data types, message structures and code tables; search definitions by concept; parse and validate messages. All reference data is v2.5.1. Codes from later HL7 versions are labelled and never presented as valid v2.5.1 values. Use synthetic or de-identified messages.",
    }
  );
  reference.register(server);
  messages.register(server);
  resources.register(server);
  return server;
}
