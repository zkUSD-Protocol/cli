import fs from "fs-extra";
import path from "path";
import os from "os";
import chalk from "chalk";
import net from "net";

// Session directory for prover status
const SESSION_DIR = path.join(os.homedir(), ".zkusd", ".session");
const PROVER_INFO_FILE = path.join(SESSION_DIR, "prover-info.json");

// Type for prover information
export interface ProverInfo {
  url: string;
  port: string;
  chain: string;
  startTime: string;
}

/**
 * Saves information about a running prover
 */
export function saveProverInfo(port: string, chain: string): void {
  fs.ensureDirSync(SESSION_DIR);

  const url = `http://localhost:${port}`;
  const proverInfo: ProverInfo = {
    url,
    port,
    chain,
    startTime: new Date().toISOString(),
  };

  fs.writeJSONSync(PROVER_INFO_FILE, proverInfo, { spaces: 2 });
}

/**
 * Removes the prover info file
 */
export function removeProverInfo(): void {
  fs.unlinkSync(PROVER_INFO_FILE);
}

/**
 * Gets information about the most recently started prover
 */
export function getProverInfo(): ProverInfo | null {
  try {
    if (fs.existsSync(PROVER_INFO_FILE)) {
      return fs.readJSONSync(PROVER_INFO_FILE) as ProverInfo;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Checks if the prover is currently running by attempting a TCP connection
 * @returns true if prover is running, false otherwise
 */
export function isProverRunning(): Promise<boolean> {
  const proverInfo = getProverInfo();
  if (!proverInfo) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const port = parseInt(proverInfo.port);

    // Set a timeout for the connection attempt
    socket.setTimeout(1000);

    // Handle connection success
    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });

    // Handle any errors or timeouts
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    // Attempt to connect
    socket.connect(port, "localhost");
  });
}

/**
 * Gets the URL of the running prover
 * @returns Prover URL if running, null otherwise
 */
export async function getProverUrl(): Promise<string | null> {
  const proverInfo = getProverInfo();
  if (!proverInfo) return null;

  const isRunning = await isProverRunning();
  if (!isRunning) return null;

  return proverInfo.url;
}
