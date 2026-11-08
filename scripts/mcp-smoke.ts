/**
 * Smoke test for the MCP server, using the official MCP client over stdio, exactly as an
 * agent host would. Calls every tool, including one refused spend and (with --spend) one real spend.
 *
 *   pnpm --filter @ration/mcp build && pnpm mcp-smoke [--spend]
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const real = process.argv.includes("--spend");
const transport = new StdioClientTransport({
  command: "node",
  args: ["packages/mcp/dist/mcp/src/index.js"],
  env: { ...(process.env as Record<string, string>), RATION_LOG_PORT: "7399" },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const show = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  console.log(`\n--- ${name} ${JSON.stringify(args)}${r.isError ? "  [isError]" : ""}\n${r.content[0].text}`);
  return r;
};

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
await show("get_budget");
await show("get_slices");
await show("get_remaining");
const denied = await show("request_spend", { chain: "base", to: "0x000000000000000000000000000000000000dEaD", amount: "99999" });
if (!denied.isError) throw new Error("expected a denial");
await show("request_spend", { chain: "nowhere", to: "0x000000000000000000000000000000000000dEaD", amount: "1" });
if (real) await show("request_spend", { chain: "base", to: "0x000000000000000000000000000000000000dEaD", amount: "5" });
await show("get_ledger", { limit: 5 });

const log = await (await fetch("http://127.0.0.1:7399/calls")).json();
console.log(`\ncall log has ${log.calls.length} entries; last: ${log.calls.at(-1)?.tool}`);
await client.close();
