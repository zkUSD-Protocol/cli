/**
 * @title Account Commands Module
 * @notice This module provides commands for managing user accounts
 * @dev Implements account import, listing, unlocking, locking, and status functionality
 */
import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import sessionManager from "../utils/session.js";
import { importKey, listKeystores, removeKeystore } from "../utils/keystore.js";
import { CommandBase } from "./base.js";
import { PrivateKey } from "o1js";

/**
 * @dev Interface for keystore import responses
 */
interface KeystoreAnswers {
  name: string;
  privateKey: string;
  password: string;
  confirmPassword: string;
}

/**
 * @dev Interface for password prompts
 */
interface PasswordAnswer {
  password: string;
}

/**
 * @dev Interface for confirmation prompts
 */
interface ConfirmationAnswer {
  confirm: boolean;
}

/**
 * @title AccountCommand
 * @notice Class that implements account-related commands
 * @dev Extends CommandBase to provide a standardized command interface
 */
export class AccountCommand extends CommandBase {
  constructor() {
    super("account", "Account management commands");
  }

  /**
   * @notice Registers all account-related commands with the program
   * @param program The Commander program to register commands with
   */
  public register(program: Command): void {
    const accountCommand = program
      .command(this.name)
      .description(this.description);

    this.registerImportCommand(accountCommand);
    this.registerListCommand(accountCommand);
    this.registerUnlockCommand(accountCommand);
    this.registerLockCommand(accountCommand);
    this.registerStatusCommand(accountCommand);
    this.registerRemoveCommand(accountCommand);
  }

  /**
   * @notice Registers the import subcommand
   * @dev Imports a Mina account to the keystore
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerImportCommand(parentCommand: Command): void {
    parentCommand
      .command("import")
      .description("Import a Mina account to the keystore")
      .action(async () => {
        const answers = await inquirer.prompt<KeystoreAnswers>([
          {
            type: "input",
            name: "name",
            message: "Enter a name for this account:",
            validate: (input: string): boolean => input.trim().length > 0,
          },
          {
            type: "password",
            name: "privateKey",
            message: "Enter your private key:",
            mask: "*",
            validate: async (input: string): Promise<boolean | string> => {
              try {
                // Attempt to parse the private key
                PrivateKey.fromBase58(input);
                return true;
              } catch (error) {
                return "Invalid private key format. Please enter a valid base58-encoded Mina private key.";
              }
            },
          },
          {
            type: "password",
            name: "password",
            message: "Enter a password to encrypt your account:",
            mask: "*",
          },
          {
            type: "password",
            name: "confirmPassword",
            message: "Confirm your password:",
            mask: "*",
            validate: (input: string, answers: any): boolean | string => {
              return input === answers.password || "Passwords do not match";
            },
          },
        ]);

        await importKey(answers.name, answers.privateKey, answers.password);
      });
  }

  /**
   * @notice Registers the list subcommand
   * @dev Lists all available accounts in the keystore
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerListCommand(parentCommand: Command): void {
    parentCommand
      .command("list")
      .description("List all available accounts in the keystore")
      .action(() => {
        listKeystores();
      });
  }

  /**
   * @notice Registers the unlock subcommand
   * @dev Unlocks an account and keeps it active for the session
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerUnlockCommand(parentCommand: Command): void {
    parentCommand
      .command("unlock")
      .description("Unlock an account and keep it active for the session")
      .argument("<n>", "Name of the account to unlock")
      .option("-t, --timeout <minutes>", "Set session timeout in minutes", "30")
      .action(async (name, options) => {
        try {
          // Set session timeout if provided
          if (options.timeout) {
            const timeout = parseInt(options.timeout);
            if (isNaN(timeout) || timeout <= 0) {
              console.error(chalk.red("Timeout must be a positive number"));
              return;
            }
            sessionManager.setSessionTimeout(timeout);
          }

          // If an account is already unlocked, warn the user
          if (await sessionManager.isAccountUnlocked()) {
            const currentAccount = sessionManager.getActiveAccountName();
            console.log(
              chalk.yellow(
                `Account "${currentAccount}" is already unlocked. Switching to "${name}"...`
              )
            );
            sessionManager.lockAccount();
          }

          // Interactive prompt for password
          const answers = await inquirer.prompt<PasswordAnswer>([
            {
              type: "password",
              name: "password",
              message: `Enter password for keystore "${name}":`,
              mask: "*",
            },
          ]);

          // Unlock the requested account
          const success = await sessionManager.unlockAccount(
            name,
            answers.password
          );
          if (success) {
            console.log(
              chalk.green(
                `Account "${name}" unlocked and will remain active for ${options.timeout} minutes`
              )
            );
          }
        } catch (error: any) {
          console.error(chalk.red(`Error unlocking account: ${error.message}`));
        }
      });
  }

  /**
   * @notice Registers the lock subcommand
   * @dev Locks the currently active account
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerLockCommand(parentCommand: Command): void {
    parentCommand
      .command("lock")
      .description("Lock the currently active account")
      .action(() => {
        try {
          if (!sessionManager.isAccountUnlocked()) {
            console.log(chalk.yellow("No account is currently unlocked"));
            return;
          }

          const name = sessionManager.getActiveAccountName();
          sessionManager.lockAccount();
          console.log(chalk.green(`Account "${name}" has been locked`));
        } catch (error: any) {
          console.error(chalk.red(`Error locking account: ${error.message}`));
        }
      });
  }

  /**
   * @notice Registers the status subcommand
   * @dev Shows the status of the active account
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerStatusCommand(parentCommand: Command): void {
    parentCommand
      .command("status")
      .description("Show the status of the active account")
      .action(async () => {
        try {
          const account = await sessionManager.getAccountForCommand();

          if (!account) {
            console.log(chalk.yellow("No active account"));
            console.log(
              chalk.gray(
                "Use 'zkusd account unlock <n>' to unlock an account for use with commands"
              )
            );
            console.log(chalk.gray("Available accounts:"));
            listKeystores();
            return;
          }

          console.log(chalk.green(`Active account: ${account.name}`));
          console.log(`Public key: ${account.keyPair.publicKey.toBase58()}`);
          console.log(
            `Unlocked at: ${account.unlockTime.toLocaleTimeString()}`
          );
        } catch (error: any) {
          console.error(
            chalk.red(`Error checking account status: ${error.message}`)
          );
        }
      });
  }

  /**
   * @notice Registers the remove subcommand
   * @dev Removes an account from the keystore
   * @param parentCommand The parent command to attach this subcommand to
   */
  private registerRemoveCommand(parentCommand: Command): void {
    parentCommand
      .command("remove")
      .description("Remove an account from the keystore")
      .argument("<name>", "Name of the account to remove")
      .action(async (name) => {
        try {
          // Check if account exists
          const currentAccount = sessionManager.getActiveAccountName();
          if (currentAccount === name) {
            console.log(
              chalk.yellow(
                `Account "${name}" is currently unlocked. It will be locked before removal.`
              )
            );
          }

          // Require confirmation
          const answers = await inquirer.prompt<ConfirmationAnswer>([
            {
              type: "confirm",
              name: "confirm",
              message: chalk.red(
                `⚠️  WARNING: This will permanently delete the account "${name}". This action cannot be undone. Are you sure?`
              ),
              default: false,
            },
          ]);

          if (!answers.confirm) {
            console.log(chalk.yellow("Account removal cancelled."));
            return;
          }

          // Remove from session if it's active
          await sessionManager.removeAccount(name);

          // Remove the keystore file
          const removed = removeKeystore(name);
          if (removed) {
            console.log(
              chalk.green(`Account "${name}" has been removed successfully.`)
            );
          }
        } catch (error: any) {
          console.error(chalk.red(`Error removing account: ${error.message}`));
        }
      });
  }
}

/**
 * @notice Factory function to register account commands with the program
 * @param program The Commander program to register commands with
 */
export function register(program: Command): void {
  const accountCommand = new AccountCommand();
  accountCommand.register(program);
}
