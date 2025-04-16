import { ZKUSDClient, type blockchain } from "@zkusd/core";
import { getCurrentChain } from "./network.js";
import { getProverInfo, isProverRunning, ProverInfo } from "./prover.js";
import chalk from "chalk";
import ora from "ora";

export async function getClient(
  proverRequired: boolean = true
): Promise<ZKUSDClient> {
  // Check if chain is configured
  const chain = getCurrentChain();

  let proverUrl = "";
  let proverInfo: ProverInfo | null = null;

  // Only check for prover if it's required
  if (proverRequired) {
    const spinner = ora("Connecting to local prover...").start();
    const proverRunning = await isProverRunning();

    if (!proverRunning) {
      spinner.fail("No running prover detected");
      proverInfo = getProverInfo();

      if (proverInfo) {
        console.log(
          chalk.yellow(
            `The most recent prover was started on port ${proverInfo.port} for chain ${proverInfo.chain}, but it's not currently running.`
          )
        );
      }

      console.log(
        chalk.yellow(
          "The prover is not running. Please use the 'zkusd start-prover' command to start it."
        )
      );

      process.exit(1);
    }

    // Get prover information
    proverInfo = getProverInfo()!;

    // Check if prover chain matches configured chain
    if (proverInfo.chain !== chain) {
      spinner.warn(
        chalk.yellow(
          `Warning: The running prover is configured for chain '${proverInfo.chain}' but you're using chain '${chain}'`
        )
      );
      console.log(
        chalk.yellow(
          "This might cause unexpected behavior. Please restart the prover with the correct chain."
        )
      );

      process.exit(1);
    }

    proverUrl = proverInfo.url;
    spinner.succeed(
      `Connected to prover at ${proverUrl} (${proverInfo.chain})`
    );
  }

  // Create client
  try {
    const client = await ZKUSDClient.create({
      chain: chain as blockchain,
      httpProver: proverUrl,
    });

    return client;
  } catch (error: any) {
    console.error(chalk.red(`Failed to initialize client: ${error.message}`));
    throw error;
  }
}
