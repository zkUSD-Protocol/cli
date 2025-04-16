#!/usr/bin/env node
/**
 * @title ZKUSD CLI Entry Point
 * @notice Main entry point for the ZKUSD command-line interface
 * @dev Initializes the CLI environment and registers all command modules
 */
import { Command } from "commander";
import { checkAndCreateConfigDirs } from "./utils/keystore.js";
import { AccountCommand } from "./commands/account.js";
import { NetworkCommand } from "./commands/network.js";
import { ProverCommand } from "./commands/prover.js";
import { VaultCommand } from "./commands/vault.js";
import { createCommandFactory } from "./commands/factory.js";
import chalk from "chalk";
import { LightnetCommand } from "./commands/lightnet.js";

/**
 * @notice CLI main class
 * @dev Responsible for initializing and configuring the CLI
 */
class ZkUsdCli {
  /**
   * @notice The root command object
   * @dev All subcommands are attached to this object
   */
  private program: Command;

  /**
   * @notice Initialize the CLI
   */
  constructor() {
    // Ensure config directories exist
    checkAndCreateConfigDirs();

    // Create the root command
    this.program = new Command();
    this.configure();
  }

  /**
   * @notice Display ASCII art banner
   * @dev Shows a cool ASCII art banner when help is displayed
   */
  private displayBanner(): void {
    const banner = `
${chalk.green("███████╗██╗███████╗██╗  ██╗")}
${chalk.green("██╔════╝██║╚══███╔╝██║ ██╔╝")}
${chalk.green("█████╗  ██║  ███╔╝ █████╔╝ ")}
${chalk.green("██╔══╝  ██║ ███╔╝  ██╔═██╗ ")}
${chalk.green("██║     ██║███████╗██║  ██╗")}
${chalk.green("╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝")}
${chalk.cyan("➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖")}
${chalk.yellow("   📈 Mina Stablecoin Protocol 📈")}
${chalk.cyan("➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖")}
    `;

    console.log(banner);
  }

  /**
   * @notice Configure the CLI program
   * @dev Sets up the program metadata and registers command modules
   */
  private configure(): void {
    this.program
      .name("zkusd")
      .description("CLI tool for interacting with the Fizk Protocol")
      .version("1.0.0");

    // Register command modules
    this.registerCommands();
  }

  /**
   * @notice Register all command modules with the program
   * @dev Creates and registers all command classes through the command factory
   */
  private registerCommands(): void {
    // Create command instances
    const accountCommand = new AccountCommand();
    const networkCommand = new NetworkCommand();
    const proverCommand = new ProverCommand();
    const vaultCommand = new VaultCommand();
    const lightnetCommand = new LightnetCommand();

    // Create command factory and register all commands
    const commandFactory = createCommandFactory([
      accountCommand,
      networkCommand,
      proverCommand,
      vaultCommand,
      lightnetCommand,
    ]);

    // Register all commands with the program
    commandFactory.registerAll(this.program);
  }

  /**
   * @notice Parse command line arguments and execute the matching command
   */
  public run(): void {
    // If no arguments provided (just "zkusd"), show help with banner
    if (process.argv.length <= 2) {
      this.displayBanner();
      this.program.help(); // This will show help without triggering additional banners
      return;
    }

    this.program.parse(process.argv);
  }
}

// Create and run the CLI
const cli = new ZkUsdCli();
cli.run();
