import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getCurrentChain, setChain, VALID_CHAINS } from "../utils/network.js";

export function register(program: Command): void {
  // Main network command group
  const networkCommand = program
    .command("network")
    .description("Network and chain configuration commands");

  // Get current chain command
  networkCommand
    .command("current")
    .description("Show the currently configured chain")
    .action(() => {
      const chain = getCurrentChain();
      console.log(chalk.green(`Current chain: ${chain}`));
    });

  // Set chain command
  networkCommand
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

  // List available chains
  networkCommand
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
