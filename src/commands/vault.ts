/**
 * @title Vault Command Module
 * @notice Provides commands for interacting with zkUSD Vaults
 * @dev Implements commands for creating, querying, and managing Vaults
 */
import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora, { Ora } from "ora";
import { PrivateKey, UInt64 } from "o1js";
import sessionManager from "../utils/session.js";
import { getClient } from "../utils/client.js";
import {
  oracleAggregationVk,
  MinaPriceInput,
  TransactionHandle,
  TransactionPhase,
  VaultState,
} from "@zkusd/core";
import { fetchLastBlock } from "o1js";
import { getPriceProof } from "../utils/price-proof.js";
import {
  formatCollateralizationRatio,
  formatHealthFactor,
  formatLiquidationRisk,
} from "../utils/loan.js";
import { CommandBase } from "./base.js";
import { checkMinaBalance } from "../utils/balance.js";
import {
  findLiquidatableVaults,
  getAccountVaultAliases,
  listVaults,
  listVaultsByHealthFactor,
  removeVaultAlias,
  resolveVaultAlias,
  setVaultAlias,
} from "../utils/vault-manager.js";
import { EventCache } from "../utils/event-cache.js";
/**
 * @title VaultCommand
 * @notice Class that implements vault-related commands
 * @dev Extends CommandBase to provide standardized command interface
 */
export class VaultCommand extends CommandBase {
  /**
   * @notice Creates a new VaultCommand instance
   */
  constructor() {
    super("vault", "Interact with zkUSD Vaults");
  }

  /**
   * @notice Registers all vault-related commands with the program
   * @param program The Commander program to register commands with
   */
  public register(program: Command): void {
    const vaultCommand = program
      .command(this.name)
      .description(this.description);

    this.registerListCommand(vaultCommand);
    this.registerCreateCommand(vaultCommand);
    this.registerShowCommand(vaultCommand);
    this.registerDepositCommand(vaultCommand);
    this.registerWithdrawCommand(vaultCommand);
    this.registerMintCommand(vaultCommand);
    this.registerRepayCommand(vaultCommand);
    this.registerLiquidateCommand(vaultCommand);
    this.registerAliasSetCommand(vaultCommand);
    this.registerAliasRemoveCommand(vaultCommand);
    this.registerAliasListCommand(vaultCommand);
    this.registerListHealthFactorCommand(vaultCommand);
    this.registerListLiquidatableCommand(vaultCommand);
  }

  /**
   * @notice Resolves a vault address or alias to a vault address
   * @param vaultAddressOrAlias The vault address or alias to resolve
   * @return The resolved vault address
   */
  private async resolveVaultAddressOrAlias(
    vaultAddressOrAlias: string
  ): Promise<string> {
    const account = await sessionManager.getAccountForCommand();
    if (!account) {
      process.exit(1);
    }

    const ownerAddress = account.keyPair.publicKey.toBase58();

    // Try to resolve the alias
    const resolvedAddress = resolveVaultAlias(
      vaultAddressOrAlias,
      ownerAddress
    );

    if (!resolvedAddress) {
      // If not an alias, use as-is (might be an actual address)
      return vaultAddressOrAlias;
    }

    return resolvedAddress;
  }

  /**
   * @notice Monitors a transaction through its lifecycle phases
   * @dev Updates a spinner with the current transaction status
   * @param txHandle The transaction handle to monitor
   * @param spinner The spinner to update with status information
   * @return Promise that resolves when the transaction is included in a block
   */
  private async monitorTransaction(
    txHandle: TransactionHandle,
    spinner: Ora
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      txHandle.subscribeToLifecycle(async (lifecycle) => {
        const { phase, status } = lifecycle;

        switch (phase) {
          case TransactionPhase.PROVING:
            spinner.text = "Proving transaction...";
            break;
          case TransactionPhase.BUILDING:
            spinner.text = "Transaction built, waiting to send...";
            break;
          case TransactionPhase.SENDING:
            spinner.text = "Sending transaction to network...";
            break;
          case TransactionPhase.PENDING_INCLUSION:
            spinner.text = `Transaction sent, awaiting inclusion in a block... Hash: ${
              txHandle.hash || "pending"
            }`;
            break;
          case TransactionPhase.INCLUDED:
            spinner.succeed(`Transaction included in block!`);
            if (txHandle.hash) {
              console.log(chalk.green(`Transaction hash: ${txHandle.hash}`));
            }
            resolve(true);
            break;
        }

        if (status === "FAILED" || status === "EXCEPTION") {
          spinner.fail(`Transaction failed during ${phase} phase`);
          console.error(chalk.red(lifecycle.errors || "Unknown error"));
          reject(
            new Error(
              `Transaction failed: ${lifecycle.errors || "Unknown error"}`
            )
          );
        }
      });
    });
  }

  /**
   * @notice Gets the latest MINA price proof
   * @dev Retrieves the oracle price proof for MINA in USD
   * @return The price proof object with verification key
   */
  private async getLatestPriceProof(spinner: Ora) {
    try {
      return await getPriceProof(spinner);
    } catch (error: any) {
      throw new Error("Failed to get price proof: " + error.message);
    }
  }

  /**
   * @notice Registers the alias-set subcommand
   * @dev Sets an alias for a vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerAliasSetCommand(parentCommand: Command): void {
    parentCommand
      .command("alias-set")
      .description("Set an alias for a vault address")
      .argument("<vault-address>", "The vault address to set an alias for")
      .argument("<alias>", "The alias to set for the vault")
      .action(async (vaultAddress, alias) => {
        try {
          // Get the current account
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const ownerAddress = account.keyPair.publicKey.toBase58();

          // Check if the vault exists
          const client = await getClient(false); // No prover needed for read operation

          let vaultState: VaultState;

          try {
            // Try to fetch the vault state to verify it exists
            vaultState = await client.getVaultState(vaultAddress);
          } catch (error) {
            console.error(chalk.red(`Vault not found: ${vaultAddress}`));
            process.exit(1);
          }

          //Make sure the user owns the vault
          if (vaultState.owner?.toBase58() !== ownerAddress) {
            console.error(
              chalk.yellow(`You do not own this vault: ${vaultAddress}`)
            );
            process.exit(1);
          }

          // Set the alias
          if (setVaultAlias(alias, vaultAddress, ownerAddress)) {
            console.log(
              chalk.green(`Alias '${alias}' set for vault ${vaultAddress}`)
            );
            process.exit(0);
          } else {
            console.error(
              chalk.red(
                `Failed to set alias '${alias}' for vault ${vaultAddress}`
              )
            );
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the alias-remove subcommand
   * @dev Removes an alias for a vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerAliasRemoveCommand(parentCommand: Command): void {
    parentCommand
      .command("alias-remove")
      .description("Remove an alias for a vault")
      .argument("<alias>", "The alias to remove")
      .action(async (alias) => {
        try {
          // Get the current account
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const ownerAddress = account.keyPair.publicKey.toBase58();

          // Remove the alias
          if (removeVaultAlias(alias, ownerAddress)) {
            console.log(chalk.green(`Alias '${alias}' removed`));
            process.exit(0);
          } else {
            console.error(chalk.red(`Alias '${alias}' not found`));
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the alias-list subcommand
   * @dev Lists all aliases for the current account
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerAliasListCommand(parentCommand: Command): void {
    parentCommand
      .command("alias-list")
      .description("List all vault aliases for the current account")
      .action(async () => {
        try {
          // Get the current account
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const ownerAddress = account.keyPair.publicKey.toBase58();

          // Get all aliases for the account
          const aliases = getAccountVaultAliases(ownerAddress);
          const aliasCount = Object.keys(aliases).length;

          if (aliasCount === 0) {
            console.log(
              chalk.yellow("No vault aliases found for the current account")
            );
            console.log(
              chalk.gray(
                "Use 'zkusd vault alias-set <vault-address> <alias>' to create an alias"
              )
            );
            process.exit(0);
          }

          console.log(
            chalk.cyan(`Found ${aliasCount} vault alias(es) for your account:`)
          );
          console.log();

          // Display each alias
          for (const [alias, address] of Object.entries(aliases)) {
            console.log(chalk.green(`Alias: ${alias}`));
            console.log(`Vault: ${address}`);
            console.log();
          }

          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Lists all vaults owned by the current account
   * @dev Lists all vaults owned by the current account
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerListCommand(parentCommand: Command): void {
    parentCommand
      .command("list")
      .description("List all vaults owned by the current account")
      .action(async () => {
        const spinner = ora("Fetching your vaults...").start();
        const proverRequired = false;

        try {
          // Get the current account
          const account = await sessionManager.getAccountForCommand();

          const ownerAddress = account!.keyPair.publicKey.toBase58();

          // Get a client instance
          const client = await getClient(proverRequired);

          // List vaults owned by the account
          const vaults = await listVaults(ownerAddress, client);

          spinner.succeed(
            `Found ${vaults.length} vault(s) owned by your account`
          );

          if (vaults.length === 0) {
            console.log(
              chalk.yellow("\nYou don't have any vaults yet."),
              chalk.gray("\nUse 'zkusd vault create' to create a new vault.")
            );
            process.exit(0);
          }

          // Display each vault
          console.log(chalk.cyan("\nYour vaults:"));

          for (const [index, vault] of vaults.entries()) {
            // Display vault address with alias if available
            const aliasDisplay = vault.alias ? ` (alias: ${vault.alias})` : "";
            console.log(
              chalk.green(
                `\n${index + 1}. Vault: ${vault.address}${aliasDisplay}`
              )
            );

            const collateralAmount =
              Number(vault.state.collateralAmount.toBigInt()) / 1e9;
            const debtAmount = Number(vault.state.debtAmount.toBigInt()) / 1e9;

            if (vault.state) {
              console.log(`   Collateral: ${collateralAmount} MINA`);
              console.log(`   Debt: ${debtAmount} zkUSD`);
              // If we have price info, we could calculate more metrics
            } else {
              console.log(
                chalk.yellow("   State unavailable. The vault may be inactive.")
              );
            }
          }

          if (vaults.length > 0) {
            console.log(
              chalk.gray("\nUse 'zkusd vault show <address>' for more details")
            );
            console.log(
              chalk.gray(
                "Use 'zkusd vault alias-set <address> <alias>' to create aliases for your vaults"
              )
            );
          }

          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to list vaults: ${error.message}`);
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the list-liquidatable subcommand
   * @dev Lists vaults that are eligible for liquidation (health factor < 100)
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerListLiquidatableCommand(parentCommand: Command): void {
    parentCommand
      .command("list-liquidatable")
      .description("List vaults that are currently eligible for liquidation")
      .action(async () => {
        const spinner = ora(
          "Analyzing vaults for liquidation eligibility..."
        ).start();
        const proverRequired = false;

        try {
          // Get a client instance
          const client = await getClient(proverRequired);

          // Get price proof for calculations
          const priceProof = await this.getLatestPriceProof(spinner);

          spinner.text = "Finding liquidatable vaults...";

          // Get liquidatable vaults
          const liquidatableVaults = await findLiquidatableVaults(
            client,
            priceProof
          );

          spinner.succeed(
            `Found ${liquidatableVaults.length} liquidatable vaults`
          );

          if (liquidatableVaults.length === 0) {
            console.log(
              chalk.yellow(
                "\nNo liquidatable vaults found at the current price"
              )
            );
            process.exit(0);
          }

          // Display liquidatable vaults
          console.log(chalk.cyan("\nLiquidatable Vaults:"));

          for (const [index, vault] of liquidatableVaults.entries()) {
            console.log(chalk.red(`\n${index + 1}. Vault: ${vault.address}`));
            console.log(`   Owner: ${vault.owner}`);
            console.log(`   Collateral: ${vault.collateral} MINA`);
            console.log(`   Debt: ${vault.debt} zkUSD`);
            console.log(
              `   Health Factor: ${formatHealthFactor(vault.healthFactor)}`
            );
            console.log(
              `   Status: ${formatLiquidationRisk(vault.healthFactor)}`
            );
          }

          console.log(
            chalk.gray(
              "\nUse 'zkusd vault liquidate <address>' to liquidate a vault"
            )
          );

          process.exit(0);
        } catch (error: any) {
          spinner.fail(
            `Failed to analyze liquidatable vaults: ${error.message}`
          );
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the list-hf subcommand
   * @dev Lists vaults with health factors in a specified range
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerListHealthFactorCommand(parentCommand: Command): void {
    parentCommand
      .command("list-hf")
      .description("List vaults with health factors in a specified range")
      .argument(
        "<operator>",
        "Operator for comparison: 'lt' (less than) or 'gt' (greater than)"
      )
      .argument("<value>", "Health factor threshold value")
      .action(async (operator, value) => {
        // Validate operator
        if (operator !== "lt" && operator !== "gt") {
          console.error(
            chalk.red(
              "Invalid operator. Use 'lt' for less than or 'gt' for greater than"
            )
          );
          process.exit(1);
        }

        // Validate threshold value
        const threshold = parseFloat(value);
        if (isNaN(threshold)) {
          console.error(
            chalk.red("Invalid threshold value. Please provide a number")
          );
          process.exit(1);
        }

        const spinner = ora(
          `Finding vaults with health factor ${
            operator === "lt" ? "<" : ">"
          } ${threshold}...`
        ).start();
        const proverRequired = false;

        try {
          // Get a client instance
          const client = await getClient(proverRequired);

          // Get price proof for calculations
          const priceProof = await this.getLatestPriceProof(spinner);

          // Get matching vaults
          const matchingVaults = await listVaultsByHealthFactor(
            client,
            operator as "lt" | "gt",
            threshold,
            priceProof
          );

          spinner.succeed(
            `Found ${matchingVaults.length} vaults with health factor ${
              operator === "lt" ? "<" : ">"
            } ${threshold}`
          );

          if (matchingVaults.length === 0) {
            console.log(
              chalk.yellow(
                `\nNo vaults found with health factor ${
                  operator === "lt" ? "<" : ">"
                } ${threshold}`
              )
            );
            process.exit(0);
          }

          // Display matching vaults
          console.log(
            chalk.cyan(
              `\nVaults with Health Factor ${
                operator === "lt" ? "<" : ">"
              } ${threshold}:`
            )
          );

          for (const [index, vault] of matchingVaults.entries()) {
            // Determine color based on health factor
            let statusColor = chalk.green;
            if (vault.healthFactor < 120) statusColor = chalk.red;
            else if (vault.healthFactor < 150) statusColor = chalk.yellow;

            console.log(statusColor(`\n${index + 1}. Vault: ${vault.address}`));
            console.log(`   Owner: ${vault.owner}`);
            console.log(`   Collateral: ${vault.collateral} MINA`);
            console.log(`   Debt: ${vault.debt} zkUSD`);
            console.log(
              `   Health Factor: ${formatHealthFactor(vault.healthFactor)}`
            );
            console.log(
              `   Status: ${formatLiquidationRisk(vault.healthFactor)}`
            );
          }

          if (operator === "lt" && threshold <= 100) {
            console.log(
              chalk.gray(
                "\nUse 'zkusd vault liquidate <address>' to liquidate a vault"
              )
            );
          }

          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to analyze vaults: ${error.message}`);
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the create subcommand
   * @dev Creates a new vault owned by the current account
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerCreateCommand(parentCommand: Command): void {
    parentCommand
      .command("create")
      .description("Create a new vault")
      .action(async () => {
        try {
          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          const spinner = ora("Creating vault...").start();

          try {
            // Create a unique private key for this vault
            const vaultPrivateKey = PrivateKey.random(); // In production, use a derived key instead

            // Create the vault
            const txHandle = await client.createVault(
              account.keyPair,
              vaultPrivateKey
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(chalk.green(`✓ Vault created successfully!`));
            console.log(
              chalk.cyan(
                `Vault address: ${vaultPrivateKey.toPublicKey().toBase58()}`
              )
            );
            console.log(
              chalk.gray(
                "You can now deposit collateral to start using your vault"
              )
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to create vault: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the show subcommand
   * @dev Shows detailed information about a vault's status and health
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerShowCommand(parentCommand: Command): void {
    parentCommand
      .command("show")
      .description("Show the status of a vault")
      .argument("<vault-address>", "The address of the vault to check")
      .action(async (vaultAddressOrAlias) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          const spinner = ora(
            `Analyzing vault health for ${vaultAddress}...`
          ).start();

          const proverRequired = false;

          try {
            // Get client instance
            const client = await getClient(proverRequired);

            // Get price proof for calculations
            const priceProof = await this.getLatestPriceProof(spinner);

            // Get vault state
            const vaultState = await client.getVaultState(vaultAddress);

            // Calculate health factor and collateralization ratio
            const healthFactor = await client.getVaultHealthFactor(
              vaultAddress,
              priceProof
            );
            const collateralizationRatio =
              await client.getVaultCollateralizationRatio(
                vaultAddress,
                priceProof
              );

            spinner.succeed("Vault health analysis complete");

            // Format amounts for display
            const collateralInMina =
              Number(vaultState.collateralAmount.toBigInt()) / 1e9;
            const debtInZkUSD = Number(vaultState.debtAmount.toBigInt()) / 1e9;
            const minaPrice =
              Number(
                priceProof.proof.publicOutput.minaPrice.priceNanoUSD.toBigInt()
              ) / 1e9;

            console.log(chalk.cyan("=== Vault Health Status ==="));
            console.log(`Vault Address: ${vaultAddress}`);
            console.log(`Owner: ${vaultState.owner?.toBase58() || "Unknown"}`);
            console.log(`Collateral: ${collateralInMina.toFixed(2)} MINA`);
            console.log(`Debt: ${debtInZkUSD.toFixed(2)} zkUSD`);
            console.log(`MINA Price: $${minaPrice.toFixed(4)} USD`);
            console.log();
            console.log(`Health Factor: ${formatHealthFactor(healthFactor)}`);
            console.log(
              `Collateralization Ratio: ${formatCollateralizationRatio(
                collateralizationRatio
              )}`
            );
            console.log(
              `Liquidation Threshold: ${formatLiquidationRisk(healthFactor)}`
            );

            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to analyze vault health: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the deposit subcommand
   * @dev Deposits MINA as collateral into a vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerDepositCommand(parentCommand: Command): void {
    parentCommand
      .command("deposit")
      .description("Deposit MINA as collateral into a vault")
      .argument("<vault-address>", "The address of the vault to deposit to")
      .option("-a, --amount <amount>", "Amount of MINA to deposit (e.g. 1.5)")
      .action(async (vaultAddressOrAlias, options) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          let depositAmount: string;

          // If amount wasn't provided via option, prompt the user
          if (!options.amount) {
            const answers = await inquirer.prompt([
              {
                type: "input",
                name: "amount",
                message: "Enter the amount of MINA to deposit:",
                validate: (input) => {
                  const num = parseFloat(input);
                  return !isNaN(num) && num > 0
                    ? true
                    : "Please enter a valid positive number";
                },
              },
            ]);
            depositAmount = answers.amount;
          } else {
            depositAmount = options.amount;
          }

          // Convert to Mina's native unit (nanomina)
          const depositAmountNano = Math.floor(parseFloat(depositAmount) * 1e9);

          const spinner = ora(
            `Depositing ${depositAmount} MINA to vault...`
          ).start();

          try {
            // Make the deposit
            const txHandle = await client.depositCollateral(
              account.keyPair,
              vaultAddress,
              UInt64.from(depositAmountNano)
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(
              chalk.green(
                `✓ Successfully deposited ${depositAmount} MINA to vault`
              )
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to deposit collateral: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the withdraw subcommand
   * @dev Withdraws MINA collateral from a vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerWithdrawCommand(parentCommand: Command): void {
    parentCommand
      .command("withdraw")
      .description("Withdraw MINA collateral from a vault")
      .argument("<vault-address>", "The address of the vault to withdraw from")
      .option("-a, --amount <amount>", "Amount of MINA to withdraw (e.g. 1.5)")
      .action(async (vaultAddressOrAlias, options) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          let withdrawAmount: string;

          // If amount wasn't provided via option, prompt the user
          if (!options.amount) {
            const answers = await inquirer.prompt([
              {
                type: "input",
                name: "amount",
                message: "Enter the amount of MINA to withdraw:",
                validate: (input) => {
                  const num = parseFloat(input);
                  return !isNaN(num) && num > 0
                    ? true
                    : "Please enter a valid positive number";
                },
              },
            ]);
            withdrawAmount = answers.amount;
          } else {
            withdrawAmount = options.amount;
          }

          // Convert to native units
          const amountInNativeUnits = Math.floor(
            parseFloat(withdrawAmount) * 1e9
          );
          const amountUInt64 = UInt64.from(amountInNativeUnits);

          const spinner = ora(
            `Withdrawing ${withdrawAmount} MINA from vault...`
          ).start();

          try {
            // Get price proof (required for withdrawal)
            const priceProof = await this.getLatestPriceProof(spinner);

            // Execute withdrawal
            const txHandle = await client.redeemCollateral(
              account.keyPair,
              vaultAddress,
              amountUInt64,
              priceProof
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(
              chalk.green(
                `✓ Successfully withdrew ${withdrawAmount} MINA from vault`
              )
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to withdraw collateral: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the mint subcommand
   * @dev Mints zkUSD tokens against collateral in a vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerMintCommand(parentCommand: Command): void {
    parentCommand
      .command("mint")
      .description("Mint zkUSD tokens against your collateral")
      .argument("<vault-address>", "The address of the vault to mint from")
      .option("-a, --amount <amount>", "Amount of zkUSD to mint (e.g. 10)")
      .action(async (vaultAddressOrAlias, options) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          let mintAmount: string;

          // If amount wasn't provided via option, prompt the user
          if (!options.amount) {
            const answers = await inquirer.prompt([
              {
                type: "input",
                name: "amount",
                message: "Enter the amount of zkUSD to mint:",
                validate: (input) => {
                  const num = parseFloat(input);
                  return !isNaN(num) && num > 0
                    ? true
                    : "Please enter a valid positive number";
                },
              },
            ]);
            mintAmount = answers.amount;
          } else {
            mintAmount = options.amount;
          }

          // Convert to native units
          const amountInNativeUnits = Math.floor(parseFloat(mintAmount) * 1e9);
          const amountUInt64 = UInt64.from(amountInNativeUnits);

          const spinner = ora(`Minting ${mintAmount} zkUSD...`).start();

          try {
            // Get price proof (required for minting)
            const priceProof = await this.getLatestPriceProof(spinner);

            // Execute mint
            const txHandle = await client.mintZkUsd(
              account.keyPair,
              vaultAddress,
              amountUInt64,
              priceProof
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(
              chalk.green(`✓ Successfully minted ${mintAmount} zkUSD`)
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to mint zkUSD: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the repay subcommand
   * @dev Repays zkUSD debt to reduce vault obligations
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerRepayCommand(parentCommand: Command): void {
    parentCommand
      .command("repay")
      .description("Repay zkUSD tokens to reduce debt")
      .argument("<vault-address>", "The address of the vault")
      .option("-a, --amount <amount>", "Amount of zkUSD to repay (e.g. 10)")
      .action(async (vaultAddressOrAlias, options) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          let repayAmount: string;

          // If amount wasn't provided via option, prompt the user
          if (!options.amount) {
            const answers = await inquirer.prompt([
              {
                type: "input",
                name: "amount",
                message: "Enter the amount of zkUSD to repay:",
                validate: (input) => {
                  const num = parseFloat(input);
                  return !isNaN(num) && num > 0
                    ? true
                    : "Please enter a valid positive number";
                },
              },
            ]);
            repayAmount = answers.amount;
          } else {
            repayAmount = options.amount;
          }

          // Convert to native units
          const amountInNativeUnits = Math.floor(parseFloat(repayAmount) * 1e9);
          const amountUInt64 = UInt64.from(amountInNativeUnits);

          const spinner = ora(`Repaying ${repayAmount} zkUSD...`).start();

          try {
            // Execute burn
            const txHandle = await client.burnZkUsd(
              account.keyPair,
              vaultAddress,
              amountUInt64
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(
              chalk.green(`✓ Successfully repaid ${repayAmount} zkUSD`)
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to repay zkUSD: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /**
   * @notice Registers the liquidate subcommand
   * @dev Liquidates an undercollateralized vault
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerLiquidateCommand(parentCommand: Command): void {
    parentCommand
      .command("liquidate")
      .description("Liquidate an undercollateralized vault")
      .argument("<vault-address>", "The address of the vault to liquidate")
      .action(async (vaultAddressOrAlias) => {
        try {
          const vaultAddress = await this.resolveVaultAddressOrAlias(
            vaultAddressOrAlias
          );

          // Get client instance
          const client = await getClient();

          // Ensure an account is unlocked
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          // Check the MINA balance of the account
          await checkMinaBalance(account);

          // Confirm before proceeding
          const { confirmLiquidation } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmLiquidation",
              message: chalk.yellow(
                "⚠️ Liquidation is irreversible. Are you sure you want to proceed?"
              ),
              default: false,
            },
          ]);

          if (!confirmLiquidation) {
            console.log(chalk.yellow("Liquidation cancelled."));
            return;
          }

          const spinner = ora(`Liquidating vault ${vaultAddress}...`).start();

          try {
            // Get price proof (required for liquidation)
            const priceProof = await this.getLatestPriceProof(spinner);

            // Execute liquidation
            const txHandle = await client.liquidateVault(
              account.keyPair,
              vaultAddress,
              priceProof
            );

            // Monitor the transaction
            await this.monitorTransaction(txHandle, spinner);

            console.log(
              chalk.green(`✓ Vault ${vaultAddress} has been liquidated`)
            );
            process.exit(0);
          } catch (error: any) {
            spinner.fail(`Failed to liquidate vault: ${error.message}`);
            process.exit(1);
          }
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
          process.exit(1);
        }
      });
  }
}

/**
 * @notice Factory function to register vault commands with the program
 * @param program The Commander program to register commands with
 */
export function register(program: Command): void {
  const vaultCommand = new VaultCommand();
  vaultCommand.register(program);
}
