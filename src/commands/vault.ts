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
} from "@zkusd/core";
import { fetchLastBlock } from "o1js";
import { getPriceProof } from "../utils/price-proof.js";
import {
  formatCollateralizationRatio,
  formatHealthFactor,
  formatLiquidationRisk,
} from "../utils/loan.js";

// Helper function to monitor transaction progress
async function monitorTransaction(txHandle: TransactionHandle, spinner: Ora) {
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

async function getLatestPriceProof() {
  try {
    return await getPriceProof();
  } catch (error: any) {
    throw new Error("Failed to get price proof: " + error.message);
  }
}

export function register(program: Command): void {
  const vaultCommand = program
    .command("vault")
    .description("Interact with zkUSD Vaults");

  // Create a new vault
  vaultCommand
    .command("create")
    .description("Create a new vault")
    .action(async () => {
      try {
        // Get client instance
        const client = await getClient();

        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

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
          await monitorTransaction(txHandle, spinner);

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
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Get vault state
  vaultCommand
    .command("show")
    .description("Show the status of a vault")
    .argument("<vault-address>", "The address of the vault to check")
    .action(async (vaultAddress) => {
      try {
        const spinner = ora(
          `Analyzing vault health for ${vaultAddress}...`
        ).start();

        try {
          // Get client instance
          const client = await getClient();

          // Get price proof for calculations
          const priceProof = await getLatestPriceProof();

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
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Deposit collateral
  vaultCommand
    .command("deposit")
    .description("Deposit MINA as collateral into a vault")
    .argument("<vault-address>", "The address of the vault to deposit to")
    .argument("<amount>", "Amount of MINA to deposit (as a decimal number)")
    .action(async (vaultAddress, amountStr) => {
      try {
        // Get client instance
        const client = await getClient();

        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

        // Convert input to UInt64 (MINA has 9 decimals)
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          console.error(
            chalk.red("Invalid amount. Please provide a positive number.")
          );
          return;
        }

        // Convert to native units (1 MINA = 10^9 units)
        const amountInNativeUnits = BigInt(Math.floor(amount * 1e9));
        const amountUInt64 = UInt64.from(amountInNativeUnits);

        const spinner = ora(
          `Depositing ${amount} MINA as collateral...`
        ).start();

        try {
          // Execute deposit
          const txHandle = await client.depositCollateral(
            account.keyPair,
            vaultAddress,
            amountUInt64
          );

          // Monitor the transaction
          await monitorTransaction(txHandle, spinner);

          console.log(
            chalk.green(`✓ Successfully deposited ${amount} MINA to vault`)
          );
          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to deposit collateral: ${error.message}`);
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Withdraw collateral
  vaultCommand
    .command("withdraw")
    .description("Withdraw MINA collateral from a vault")
    .argument("<vault-address>", "The address of the vault to withdraw from")
    .argument("<amount>", "Amount of MINA to withdraw (as a decimal number)")
    .action(async (vaultAddress, amountStr) => {
      try {
        // Get client instance
        const client = await getClient();

        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

        // Convert input to UInt64
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          console.error(
            chalk.red("Invalid amount. Please provide a positive number.")
          );
          return;
        }

        // Convert to native units
        const amountInNativeUnits = BigInt(Math.floor(amount * 1e9));
        const amountUInt64 = UInt64.from(amountInNativeUnits);

        const spinner = ora(`Withdrawing ${amount} MINA from vault...`).start();

        try {
          // Get price proof (required for withdrawal)
          const priceProof = await getLatestPriceProof();

          // Execute withdrawal
          const txHandle = await client.redeemCollateral(
            account.keyPair,
            vaultAddress,
            amountUInt64,
            priceProof
          );

          // Monitor the transaction
          await monitorTransaction(txHandle, spinner);

          console.log(
            chalk.green(`✓ Successfully withdrew ${amount} MINA from vault`)
          );
          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to withdraw collateral: ${error.message}`);
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Mint zkUSD
  vaultCommand
    .command("mint")
    .description("Mint zkUSD tokens against your collateral")
    .argument("<vault-address>", "The address of the vault to mint from")
    .argument("<amount>", "Amount of zkUSD to mint (as a decimal number)")
    .action(async (vaultAddress, amountStr) => {
      try {
        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

        // Convert input to UInt64
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          console.error(
            chalk.red("Invalid amount. Please provide a positive number.")
          );
          return;
        }

        // Convert to native units
        const amountInNativeUnits = BigInt(Math.floor(amount * 1e9));
        const amountUInt64 = UInt64.from(amountInNativeUnits);

        const spinner = ora(`Minting ${amount} zkUSD...`).start();

        try {
          // Get price proof (required for minting)
          const priceProof = await getLatestPriceProof();

          // Get client instance
          const client = await getClient();

          // Execute mint
          const txHandle = await client.mintZkUsd(
            account.keyPair,
            vaultAddress,
            amountUInt64,
            priceProof
          );

          // Monitor the transaction
          await monitorTransaction(txHandle, spinner);

          console.log(chalk.green(`✓ Successfully minted ${amount} zkUSD`));
          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to mint zkUSD: ${error.message}`);
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Burn zkUSD
  vaultCommand
    .command("repay")
    .description("Repay zkUSD tokens to reduce debt")
    .argument("<vault-address>", "The address of the vault")
    .argument("<amount>", "Amount of zkUSD to repay (as a decimal number)")
    .action(async (vaultAddress, amountStr) => {
      try {
        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

        // Convert input to UInt64
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          console.error(
            chalk.red("Invalid amount. Please provide a positive number.")
          );
          return;
        }

        // Convert to native units
        const amountInNativeUnits = BigInt(Math.floor(amount * 1e9));
        const amountUInt64 = UInt64.from(amountInNativeUnits);

        const spinner = ora(`Repaying ${amount} zkUSD...`).start();

        try {
          // Get client instance
          const client = await getClient();

          // Execute burn
          const txHandle = await client.burnZkUsd(
            account.keyPair,
            vaultAddress,
            amountUInt64
          );

          // Monitor the transaction
          await monitorTransaction(txHandle, spinner);

          console.log(chalk.green(`✓ Successfully repaid ${amount} zkUSD`));
          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to repay zkUSD: ${error.message}`);
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });

  // Liquidate vault
  vaultCommand
    .command("liquidate")
    .description("Liquidate an undercollateralized vault")
    .argument("<vault-address>", "The address of the vault to liquidate")
    .action(async (vaultAddress) => {
      try {
        // Ensure an account is unlocked
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

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
          const priceProof = await getLatestPriceProof();

          // Get client instance
          const client = await getClient();

          // Execute liquidation
          const txHandle = await client.liquidateVault(
            account.keyPair,
            vaultAddress,
            priceProof
          );

          // Monitor the transaction
          await monitorTransaction(txHandle, spinner);

          console.log(
            chalk.green(`✓ Vault ${vaultAddress} has been liquidated`)
          );
          process.exit(0);
        } catch (error: any) {
          spinner.fail(`Failed to liquidate vault: ${error.message}`);
          console.error(chalk.red(error.stack));
        }
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    });
}
