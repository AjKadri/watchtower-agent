export type RpcFailureCategory = "dns" | "timeout" | "rate-limit" | "malformed-response" | "unsupported" | "unavailable";

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

export class RpcReadError extends Error {
  readonly category: RpcFailureCategory;
  readonly operation: string;

  constructor(operation: string, category: RpcFailureCategory, options?: ErrorOptions) {
    super(`Base RPC ${operation} failed.`, options);
    this.name = "RpcReadError";
    this.operation = operation;
    this.category = category;
  }
}

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

export function classifyRpcError(error: unknown): RpcFailureCategory {
  if (error instanceof RpcReadError) return error.category;

  const chain = errorChain(error);
  const codes = chain.map(({ code }) => String(code ?? "").toUpperCase());
  const statuses = chain.flatMap(({ status, statusCode }) => [status, statusCode]);
  const text = chain
    .flatMap(({ message, name }) => [message, name])
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  if (statuses.includes(429) || codes.includes("429") || codes.includes("-32005") || /rate.?limit|too many requests/.test(text)) {
    return "rate-limit";
  }
  if (codes.includes("ABORT_ERR") || /aborterror|operation was aborted|request was aborted/.test(text)) {
    return "timeout";
  }
  if (codes.some((code) => ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(code)) || /could not resolve|dns lookup|getaddrinfo/.test(text)) {
    return "dns";
  }
  if (codes.some((code) => ["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) || /timed? ?out|timeout/.test(text)) {
    return "timeout";
  }
  if (error instanceof SyntaxError || /invalid json|malformed (json|response)|parse.*json|json.*parse/.test(text)) {
    return "malformed-response";
  }
  if (/method not found|execution reverted|function selector was not recognized|unsupported method|pruned|missing trie node|historical state.*(?:unavailable|not available)|state.*not available/.test(text)) {
    return "unsupported";
  }
  return "unavailable";
}

export function wrapRpcError(operation: string, error: unknown): RpcReadError {
  if (error instanceof RpcReadError) return error;
  return new RpcReadError(operation, classifyRpcError(error), { cause: error });
}
