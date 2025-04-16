/**
 * @title Lightnet Command Module
 * @notice Provides commands for managing lightnet-specific settings
 * @dev Implements commands for setting and viewing lightnet-specific configuration
 */
import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { CommandBase } from "./base.js";
import {
  getLightnetPrice,
  setLightnetPrice,
  loadLightnetConfig,
} from "../utils/lightnet.js";

/**
 * @title LightnetCommand
 * @notice Class that implements lightnet-related commands
 * @dev Extends CommandBase to provide a standardized command interface
 */
export class LightnetCommand extends CommandBase {
  constructor() {
    super("lightnet", "Manage lightnet configuration settings");
  }

  /**
   * @notice Registers all lightnet-related commands with the program
   * @param program The Commander program to register commands with
   */
  public register(program: Command): void {
    const lightnetCommand = program
      .command(this.name)
      .description(this.description);

    this.registerSetPriceCommand(lightnetCommand);
    this.registerShowCommand(lightnetCommand);
  }

  /**
   * @notice Registers the set-price subcommand
   * @dev Allows setting the price to use for lightnet price proofs
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerSetPriceCommand(parentCommand: Command): void {
    parentCommand
      .command("set-price")
      .description("Set the price to use for lightnet price proofs")
      .option("-p, --price <price>", "Price value (in USD)")
      .action(async (options) => {
        let price: number;

        // If price is provided via command line option, use it
        if (options.price) {
          price = parseFloat(options.price);
          if (isNaN(price) || price <= 0) {
            console.error(
              chalk.red("Invalid price. Please provide a positive number.")
            );
            return;
          }
        } else {
          // Otherwise, prompt the user for it
          const answers = await inquirer.prompt([
            {
              type: "number",
              name: "price",
              message: "Enter the price to use for lightnet (in USD):",
              validate: (input) => {
                if (isNaN(input) || input <= 0) {
                  return "Please enter a valid positive number";
                }
                return true;
              },
            },
          ]);
          price = answers.price;
        }

        // Set the price using the utility function
        if (setLightnetPrice(price)) {
          console.log(
            chalk.green(`Price for lightnet proof generation set to $${price}`)
          );
        }
      });
  }

  /**
   * @notice Registers the show subcommand
   * @dev Displays the current configuration
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerShowCommand(parentCommand: Command): void {
    parentCommand
      .command("show")
      .description("Show the current lightnet configuration")
      .action(() => {
        const config = loadLightnetConfig();

        console.log(chalk.cyan("Current Lightnet Configuration:"));

        if (config.priceProof?.lightnet?.price !== undefined) {
          // Display the price in USD (convert from nanoUSD)
          const displayPrice = config.priceProof.lightnet.price / 1e9;
          console.log(
            chalk.green("Price Proof Value:"),
            `$${displayPrice.toFixed(4)} USD`
          );
          console.log(
            chalk.gray(
              `(Stored as ${config.priceProof.lightnet.price} nanoUSD)`
            )
          );
        } else {
          console.log(chalk.yellow("Price Proof Value:"), "Not configured");
        }

        console.log(
          chalk.gray(
            "\nUse 'zkusd lightnet set-price' to set the price for lightnet proofs"
          )
        );
      });
  }
}

/**
 * @notice Factory function to register lightnet commands with the program
 * @param program The Commander program to register commands with
 */
export function register(program: Command): void {
  const lightnetCommand = new LightnetCommand();
  lightnetCommand.register(program);
}
