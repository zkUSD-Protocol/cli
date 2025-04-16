/**
 * @title Network Command Module
 * @notice Provides commands for managing network and chain configuration
 * @dev Implements commands for viewing and changing the active blockchain network
 */
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getCurrentChain, setChain, VALID_CHAINS } from "../utils/network.js";
import { CommandBase } from "./base.js";

/**
 * @title NetworkCommand
 * @notice Class that implements network-related commands
 * @dev Extends CommandBase to provide standardized command interface
 */
export class NetworkCommand extends CommandBase {
  /**
   * @notice Creates a new NetworkCommand instance
   */
  constructor() {
    super("network", "Network and chain configuration commands");
  }

  /**
   * @notice Registers all network-related commands with the program
   * @param program The Commander program to register commands with
   */
  public register(program: Command): void {
    const networkCommand = program
      .command(this.name)
      .description(this.description);

    this.registerCurrentCommand(networkCommand);
    this.registerUseCommand(networkCommand);
    this.registerListCommand(networkCommand);
  }

  /**
   * @notice Registers the current subcommand
   * @dev Shows the currently configured chain
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerCurrentCommand(parentCommand: Command): void {
    parentCommand
      .command("current")
      .description("Show the currently configured chain")
      .action(() => {
        const chain = getCurrentChain();
        console.log(chalk.green(`Current chain: ${chain}`));
      });
  }

  /**
   * @notice Registers the use subcommand
   * @dev Sets the chain to use for all commands
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerUseCommand(parentCommand: Command): void {
    parentCommand
      .command("use")
      .description("Set the chain to use for all commands")
      .argument("<chain>", `Chain to use (${VALID_CHAINS.join(", ")})`)
      .action((chain) => {
        const spinner = ora(`Setting chain to ${chain}...`).start();

        if (setChain(chain)) {
          spinner.succeed(chalk.green(`Chain set to ${chain}`));
        } else {
          spinner.fail(chalk.red(`Failed to set chain to ${chain}`));
        }
      });
  }

  /**
   * @notice Registers the list subcommand
   * @dev Lists all available chains and shows the current chain
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerListCommand(parentCommand: Command): void {
    parentCommand
      .command("list")
      .description("List available chains")
      .action(() => {
        console.log(chalk.cyan("Available chains:"));

        const currentChain = getCurrentChain();

        VALID_CHAINS.forEach((chain) => {
          if (chain === currentChain) {
            console.log(chalk.green(`* ${chain} (current)`));
          } else {
            console.log(`  ${chain}`);
          }
        });

        console.log(
          chalk.gray(
            "\nUse 'zkusd network use <chain>' to change the active chain"
          )
        );
      });
  }
}

/**
 * @notice Factory function to register network commands with the program
 * @param program The Commander program to register commands with
 */
export function register(program: Command): void {
  const networkCommand = new NetworkCommand();
  networkCommand.register(program);
}
