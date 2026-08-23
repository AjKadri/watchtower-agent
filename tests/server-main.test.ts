import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { listenForRequests, reportStartupFailure, type StartupProcess } from "../src/server/main.js";

const blockers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...blockers].map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  blockers.clear();
});

describe("server startup", () => {
  it("reports listen errors and exits with a nonzero status", async () => {
    const blocker = createServer();
    blockers.add(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as AddressInfo).port;
    await expect(listenForRequests(express(), port)).rejects.toMatchObject({ code: "EADDRINUSE" });

    let stderr = "";
    const startupProcess: StartupProcess = {
      stderr: { write: (message) => { stderr += message; } },
    };
    reportStartupFailure(startupProcess);

    expect(startupProcess.exitCode).toBe(1);
    expect(stderr).toBe("Watchtower server could not start. Check the documented environment configuration.\n");
  });
});
