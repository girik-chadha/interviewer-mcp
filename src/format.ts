/**
 * Shared MCP response helpers.
 * Every tool returns through these so output shape stays consistent,
 * and every error carries a `hint` telling the model what to do next.
 */

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function ok(obj: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

export function fail(message: string, hint?: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, ...(hint ? { hint } : {}) }, null, 2),
      },
    ],
    isError: true,
  };
}

/** Wrap a tool handler so any thrown error becomes a hint-rich failure. */
export function guarded<A>(
  fn: (args: A) => Promise<ToolResult>,
  hint?: string,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(message, hint);
    }
  };
}
