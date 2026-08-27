import type { Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Express } from "express";

import { createViemChainReader } from "../chain/viem-reader.js";
import { loadRuntimeConfig } from "../config/load.js";
import { createApp } from "./app.js";

export type ListenAdapter = (app: Express, port: number, host: string) => Server;

const expressListen: ListenAdapter = (app, port, host) => app.listen(port, host);

export function listenForRequests(
  app: Express,
  port: number,
  host = "127.0.0.1",
  listen: ListenAdapter = expressListen,
): Promise<Server> {
  return new Promise((resolveListen, reject) => {
    const server = listen(app, port, host);
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}

export type StartupOutput = { write(message: string): unknown };

export async function startServer(
  app: Express,
  port: number,
  options: { host?: string; listen?: ListenAdapter; stdout?: StartupOutput } = {},
): Promise<Server> {
  const server = await listenForRequests(app, port, options.host, options.listen);
  (options.stdout ?? process.stdout).write(`Watchtower listening at http://localhost:${port}\n`);
  return server;
}

export type StartupProcess = {
  exitCode?: string | number | null;
  stderr: StartupOutput;
};

export function reportStartupFailure(target: StartupProcess = process): void {
  target.stderr.write("Watchtower server could not start. Check the documented environment configuration.\n");
  target.exitCode = 1;
}

export async function main(): Promise<void> {
  const runtime = await loadRuntimeConfig();
  const app = createApp({
    reader: createViemChainReader(runtime.rpcUrl),
    config: runtime.target,
  });
  const server = await startServer(app, runtime.port);

  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  main().catch(() => reportStartupFailure());
}
