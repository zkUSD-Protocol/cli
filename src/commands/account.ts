import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import sessionManager from "../utils/session.js";
import { importKey, listKeystores } from "../utils/keystore.js";

export function register(program: Command): void {
  const accountCommand = program
    .command("account")
    .description("Account management commands");

  // IMPORT command - from keystore.ts
  accountCommand
    .command("import")
    .description("Import a Mina account to the keystore")
    .action(async () => {
      interface KeystoreAnswers {
        name: string;
        privateKey: string;
        password: string;
        confirmPassword: string;
      }

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
            //TODO: Add validation for private key
            return input === answers.password || "Passwords do not match";
          },
        },
      ]);

      await importKey(answers.name, answers.privateKey, answers.password);
    });

  // LIST command - from keystore.ts
  accountCommand
    .command("list")
    .description("List all available accounts in the keystore")
    .action(() => {
      listKeystores();
    });

  // UNLOCK command - from wallet.ts
  accountCommand
    .command("unlock")
    .description("Unlock an account and keep it active for the session")
    .argument("<name>", "Name of the account to unlock")
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
        interface PasswordAnswer {
          password: string;
        }

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

  // LOCK command - from wallet.ts
  accountCommand
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

  accountCommand
    .command("status")
    .description("Show the status of the active account")
    .action(async () => {
      try {
        const account = await sessionManager.getAccountForCommand();

        if (!account) {
          console.log(chalk.yellow("No active account"));
          console.log(
            chalk.gray(
              "Use 'zkusd account unlock <name>' to unlock an account for use with commands"
            )
          );
          console.log(chalk.gray("Available accounts:"));
          listKeystores();
          return;
        }

        console.log(chalk.green(`Active account: ${account.name}`));
        console.log(`Public key: ${account.keyPair.publicKey.toBase58()}`);
        console.log(`Unlocked at: ${account.unlockTime.toLocaleTimeString()}`);
      } catch (error: any) {
        console.error(
          chalk.red(`Error checking account status: ${error.message}`)
        );
      }
    });
}
