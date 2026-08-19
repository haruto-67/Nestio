import type Database from 'better-sqlite3';
import { TOOL_DEFS, findToolDef, callTool } from './tools.js';
import { hasScope, type VerifiedToken } from './tokens.js';
import type { Env } from '../env.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string };
}

const PROTOCOL_VERSION = '2024-11-05';

interface ImageToolResult {
  __image: true;
  mime: string;
  data_base64: string;
}

function isImageToolResult(result: unknown): result is ImageToolResult {
  return !!result && typeof result === 'object' && '__image' in result;
}

/**
 * get_attachmentツールの戻り値だけはMCPのimage content blockに変換し、Claudeが画像として
 * 直接見られるようにする（改修16回目）。それ以外のツールは従来通りJSON文字列のtextとして返す
 */
function toolResultToContent(result: unknown): { type: string; text?: string; data?: string; mimeType?: string } {
  if (isImageToolResult(result)) {
    return { type: 'image', data: result.data_base64, mimeType: result.mime };
  }
  return { type: 'text', text: JSON.stringify(result) };
}

export async function handleMcpRequest(
  db: Database.Database,
  env: Env,
  verified: VerifiedToken,
  req: JsonRpcRequest,
): Promise<JsonRpcSuccess | JsonRpcError> {
  const id = req.id ?? null;

  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'nestio', version: '0.1.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOL_DEFS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case 'tools/call': {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const toolName = params?.name;
        if (!toolName) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'name is required' } };
        }

        const toolDef = findToolDef(toolName);
        if (!toolDef) {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${toolName}` } };
        }

        if (!hasScope(verified, toolDef.scope)) {
          return { jsonrpc: '2.0', id, error: { code: -32000, message: 'insufficient scope' } };
        }

        const result = await callTool(db, env, verified.userId, toolName, params?.arguments ?? {});
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [toolResultToContent(result)] },
        };
      }

      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${req.method}` } };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : 'internal error' },
    };
  }
}
