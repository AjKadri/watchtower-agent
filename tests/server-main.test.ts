import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import express from "express";
import { describe, expect, it } from "vitest";

import { reportStartupFailure, startServer, type ListenAdapter, type StartupProcess } from "../src/server/main.js";

describe("server startup", () => {
  it("reports listen errors and exits with a nonzero status", async () => {
    const fakeServer = new EventEmitter() as Server;
    const listen: ListenAdapter = () => fakeServer;
    let stdout = "";
    const startup = startServer(express(), 3000, {
      listen,
      stdout: { write: (message) => { stdout += message; } },
    });
    const listenError = Object.assign(new Error("address already in use"), { code: "EADDRINUSE" });
    fakeServer.emit("error", listenError);

    await expect(startup).rejects.toBe(listenError);
    expect(stdout).toBe("");

    let stderr = "";
    const startupProcess: StartupProcess = {
      stderr: { write: (message) => { stderr += message; } },
    };
    reportStartupFailure(startupProcess);

    expect(startupProcess.exitCode).toBe(1);
    expect(stderr).toBe("Watchtower server could not start. Check the documented environment configuration.\n");
  });
});
