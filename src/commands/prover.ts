/**
 * @title Prover Command Module
 * @notice Provides commands for managing the local proving service
 * @dev Implements commands for starting and managing a local ZK prover
 */
import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "child_process";
import path from "path";
import fs from "fs-extra";
import ora from "ora";
import { fileURLToPath } from "url";
import { getCurrentChain } from "../utils/network.js";
import { removeProverInfo, saveProverInfo } from "../utils/prover.js";
import { CommandBase } from "./base.js";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @title ProverCommand
 * @notice Class that implements prover-related commands
 * @dev Extends CommandBase to provide standardized command interface
 */
export class ProverCommand extends CommandBase {
  /**
   * @notice Creates a new ProverCommand instance
   */
  constructor() {
    super("prover", "zk prover management commands");
  }

  /**
   * @notice Registers all prover-related commands with the program
   * @param program The Commander program to register commands with
   */
  public register(program: Command): void {
    this.registerStartProverCommand(program);
  }

  /**
   * @notice Registers the start-prover command
   * @dev Starts a local prover for proving transactions
   * @param program The Commander program to register this command with
   */
  private registerStartProverCommand(program: Command): void {
    program
      .command("start-prover")
      .description("Start a local prover for proving transactions")
      .option("-p, --port <port>", "Port to run the prover on", "3969")
      .option("-c, --chain <chain>", "Chain to run the prover on", "devnet")
      .action(async (options) => {
        const spinner = ora("Starting prover server...").start();

        try {
          // Use the configured chain if not overridden by command options
          const chain = options.chain || getCurrentChain();

          // Determine the core package path
          const corePackagePath = this.findCorePackagePath();

          if (!corePackagePath) {
            spinner.fail(
              "Could not locate @zkusd/core package. Make sure it's installed."
            );
            return;
          }

          const proverPath = path.join(
            corePackagePath,
            "build/src/provers/node/httpclientprover-worker.js"
          );

          if (!fs.existsSync(proverPath)) {
            spinner.fail(`Prover file not found at: ${proverPath}`);
            return;
          }

          // Prepare the environment variables for the child process
          const env = {
            ...process.env,
            PORT: options.port,
            CHAIN: options.chain,
          };

          spinner.text = `Starting prover for chain: ${chain} on port ${options.port}...`;

          // Start the prover process
          const proverProcess = spawn("node", [proverPath], {
            env,
            stdio: "inherit",
          });

          spinner.succeed(
            chalk.green(
              `Prover server started on port ${options.port} for chain ${options.chain}`
            )
          );

          saveProverInfo(options.port, chain);

          console.log(chalk.gray("Press Ctrl+C to stop the prover"));

          // Handle process exit
          proverProcess.on("exit", (code) => {
            if (code !== 0) {
              console.error(chalk.red(`Prover exited with code ${code}`));
              // Remove the prover info file
              removeProverInfo();
            }
          });
        } catch (error: any) {
          spinner.fail(chalk.red(`Failed to start prover: ${error.message}`));
          console.error(error);
          process.exit(1);
        }
      });
  }

  /**
   * @notice Finds the path to the @zkusd/core package relative to CLI installation
   * @return The path to the core package or null if not found
   */
  private findCorePackagePath(): string | null {
    try {
      // Calculate CLI install directory (2 levels up from the current file in src/commands)
      const cliDirectory = path.resolve(__dirname, "../../");

      // Try to find the core package in the CLI's node_modules
      const coreInCliNodeModules = path.join(
        cliDirectory,
        "node_modules/@zkusd/core"
      );
      if (fs.existsSync(coreInCliNodeModules)) {
        return coreInCliNodeModules;
      }

      // For globally installed packages, we need to look at where the global CLI is installed
      // The structure is typically:
      // /usr/local/lib/node_modules/@zkusd/cli (CLI package)
      // /usr/local/lib/node_modules/@zkusd/core (Core package, same level as CLI)

      // First check if core is at the same level as CLI (for global installs)
      const npmRootDir = path.resolve(cliDirectory, "..");
      const coreAtSameLevel = path.join(npmRootDir, "core");
      if (fs.existsSync(coreAtSameLevel)) {
        return coreAtSameLevel;
      }

      // Check if @zkusd/core exists in the same directory as @zkusd/cli
      const coreInSameNamespace = path.join(npmRootDir, "core");
      if (fs.existsSync(coreInSameNamespace)) {
        return coreInSameNamespace;
      }

      // If still not found, check for the path via parent node_modules
      // (for the case where CLI is symlinked but dependencies are in the original location)
      const parentNodeModules = path.join(
        cliDirectory,
        "../node_modules/@zkusd/core"
      );
      if (fs.existsSync(parentNodeModules)) {
        return parentNodeModules;
      }

      try {
        // Last resort - try using a dynamic import to find the path
        // Note: This is an ESM approach
        const corePackage = new URL(
          "@zkusd/core/package.json",
          import.meta.url
        );
        return path.dirname(fileURLToPath(corePackage));
      } catch (error) {
        console.error("Error finding core package:", error);
        return null;
      }
    } catch (error: any) {
      console.error(chalk.red(`Error finding core package: ${error.message}`));
      return null;
    }
  }
}

/**
 * @notice Factory function to register prover commands with the program
 * @param program The Commander program to register commands with
 */
export function register(program: Command): void {
  const proverCommand = new ProverCommand();
  proverCommand.register(program);
}
