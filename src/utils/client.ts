import { ZKUSDClient, type blockchain } from "@zkusd/core";
import { getCurrentChain } from "./network.js";
import { getProverInfo, isProverRunning } from "./prover.js";
import chalk from "chalk";
import ora from "ora";

export async function getClient(): Promise<ZKUSDClient> {
  // Check if chain is configured
  const chain = getCurrentChain();
  if (!chain) {
    throw new Error(
      "No chain has been configured yet. Please use the 'zkusd network use <chain>' command to configure a chain."
    );
  }

  // Check if prover is running
  const spinner = ora("Connecting to local prover...").start();
  const proverRunning = await isProverRunning();

  if (!proverRunning) {
    spinner.fail("No running prover detected");
    const proverInfo = getProverInfo();

    if (proverInfo) {
      console.log(
        chalk.yellow(
          `The most recent prover was started on port ${proverInfo.port} for chain ${proverInfo.chain}, but it's not currently running.`
        )
      );
    }

    console.log(
      chalk.yellow("Please start the prover with the following command:")
    );
    console.log(
      chalk.cyan(
        `  zkusd start-prover ${proverInfo ? `-p ${proverInfo.port}` : ""}`
      )
    );
    throw new Error("Local prover is required but not running");
  }

  // Get prover information
  const proverInfo = getProverInfo()!;

  // Check if prover chain matches configured chain
  if (proverInfo.chain !== chain) {
    spinner.warn(
      chalk.yellow(
        `Warning: The running prover is configured for chain '${proverInfo.chain}' but you're using chain '${chain}'`
      )
    );
    console.log(
      chalk.yellow(
        "This might cause unexpected behavior. Consider restarting the prover with the correct chain."
      )
    );
  }

  // Create client
  try {
    const client = await ZKUSDClient.create({
      chain: chain as blockchain,
      httpProver: proverInfo.url,
    });

    spinner.succeed(
      `Connected to prover at ${proverInfo.url} (${proverInfo.chain})`
    );
    return client;
  } catch (error: any) {
    spinner.fail(`Failed to initialize client: ${error.message}`);
    throw error;
  }
}
