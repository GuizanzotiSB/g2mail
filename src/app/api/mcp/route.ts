import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "@/lib/auth";
import { buildServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Endpoint MCP (Streamable HTTP, stateless).
 * No claude.ai: Configurações → Conectores → Adicionar conector custom → URL: https://<app>/api/mcp
 * Autenticação: header Authorization: Bearer <API key> (gere em /api/keys ou use MASTER_API_KEY).
 */
async function handle(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32001, message: auth.error }, id: null }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="g2mail", error="invalid_token"' },
    });
  }
  const server = buildServer(auth.scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // stateless: fecha depois de responder
    setTimeout(() => { transport.close().catch(() => {}); server.close().catch(() => {}); }, 0);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
