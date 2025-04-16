/**
 * @title Session Management System
 * @notice Manages user sessions and account unlocking
 * @dev Securely stores credentials during CLI sessions
 */
import { PrivateKey, PublicKey } from "o1js";
import chalk from "chalk";
import { loadKeyFromStore } from "./keystore.js";
import fs from "fs-extra";
import path from "path";
import os from "os";
import keytar from "keytar"; // For secure credential storage
import { KeyPair } from "@zkusd/core";

/**
 * @notice Interface representing session metadata stored on disk
 * @dev Contains no sensitive data, only references and timestamps
 */
interface SessionMetadata {
  /** Name of the account that is unlocked */
  accountName: string;
  /** Timestamp when the account was unlocked */
  unlockTime: string;
  /** Base58 encoded public key of the account */
  publicKey: string;
}

/**
 * @notice Interface for unlocked account data returned to commands
 * @dev Includes keypair and metadata about the account
 */
export interface UnlockedAccount {
  /** Keypair containing the account's private and public keys */
  keyPair: KeyPair;
  /** Name of the account */
  name: string;
  /** Time when the account was unlocked */
  unlockTime: Date;
}

/**
 * @title SessionManager
 * @notice Manages session state for the CLI
 * @dev Implements a singleton pattern to manage unlocked accounts securely
 */
export class SessionManager {
  /**
   * @notice Location of session directory
   * @dev Only stores non-sensitive metadata
   */
  private readonly sessionDir: string;

  /**
   * @notice Path to the current session file
   * @dev Contains metadata about the currently unlocked account
   */
  private readonly sessionFile: string;

  /**
   * @notice Name used for credential storage with keytar
   * @dev Keytar stores passwords securely in the system's keychain
   */
  private readonly serviceName: string = "zkusd-cli-session";

  /**
   * @notice Default session timeout in milliseconds
   * @dev Accounts will automatically lock after this period
   */
  private sessionTimeout: number = 30 * 60 * 1000; // 30 minutes default timeout

  /**
   * @notice Singleton instance of the SessionManager
   * @dev Used to implement the singleton pattern
   */
  private static instance: SessionManager;

  /**
   * @notice Private constructor to enforce singleton pattern
   * @dev Creates session directory and initializes session storage
   */
  private constructor() {
    this.sessionDir = path.join(os.homedir(), ".zkusd", ".session");
    this.sessionFile = path.join(this.sessionDir, "current-session.json");

    // Ensure session directory exists
    fs.ensureDirSync(this.sessionDir);
  }

  /**
   * @notice Get the singleton instance of the SessionManager
   * @return The SessionManager instance
   */
  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * @notice Set the session timeout in minutes
   * @param minutes Number of minutes until the session expires
   */
  public setSessionTimeout(minutes: number): void {
    this.sessionTimeout = minutes * 60 * 1000;

    // Update the session file if active
    const session = this.getSessionMetadata();
    if (session) {
      this.saveSessionMetadata(session);
    }
  }

  /**
   * @notice Save session metadata to file
   * @dev Stores non-sensitive data about the current session
   * @param metadata The session metadata to save
   */
  private saveSessionMetadata(metadata: SessionMetadata): void {
    try {
      fs.writeJSONSync(this.sessionFile, metadata, { spaces: 2 });
    } catch (error: any) {
      console.error(chalk.red(`Failed to save session: ${error.message}`));
    }
  }

  /**
   * @notice Get current session metadata if it exists
   * @return The session metadata or null if no active session
   */
  private getSessionMetadata(): SessionMetadata | null {
    if (!fs.existsSync(this.sessionFile)) return null;

    try {
      return fs.readJSONSync(this.sessionFile) as SessionMetadata;
    } catch (error: any) {
      console.error(chalk.red(`Failed to read session: ${error.message}`));
      return null;
    }
  }

  /**
   * @notice Unlock an account and store its reference in the session
   * @param accountName Name of the account to unlock
   * @param password Password for the account
   * @return True if the account was successfully unlocked
   */
  public async unlockAccount(
    accountName: string,
    password: string
  ): Promise<boolean> {
    try {
      // First verify the password works by trying to load the key
      const keys = await loadKeyFromStore(accountName, password);
      if (!keys) {
        console.error(chalk.red(`Failed to unlock account "${accountName}"`));
        return false;
      }

      // Store the name in the session metadata
      const metadata: SessionMetadata = {
        accountName,
        unlockTime: new Date().toISOString(),
        publicKey: keys.publicKey.toBase58(),
      };

      // Save the session metadata (contains NO private key)
      this.saveSessionMetadata(metadata);

      // Store the password in the keychain for later use
      await keytar.setPassword(this.serviceName, accountName, password);

      console.log(
        chalk.green(`Account "${accountName}" is now unlocked and active`)
      );
      return true;
    } catch (error: any) {
      console.error(chalk.red(`Error unlocking account: ${error.message}`));
      return false;
    }
  }

  /**
   * @notice Check if the session is valid and active
   * @return True if the session is valid, false otherwise
   */
  private async isSessionValid(): Promise<boolean> {
    const metadata = this.getSessionMetadata();
    if (!metadata) return false;

    // Check if session has expired
    const unlockTime = new Date(metadata.unlockTime);
    const now = new Date();
    if (now.getTime() - unlockTime.getTime() > this.sessionTimeout) {
      await this.lockAccount();
      return false;
    }

    return true;
  }

  /**
   * @notice Get the active account for use in commands
   * @param requireAccount If true, will throw an error if no account is active
   * @return The loaded account or null if none is active
   */
  public async getAccountForCommand(
    requireAccount: boolean = true
  ): Promise<UnlockedAccount | null> {
    try {
      // Verify session is valid
      const isValid = await this.isSessionValid();
      if (!isValid) {
        if (requireAccount) {
          console.log(
            chalk.yellow(
              "\nNo active account session. Use 'zkusd account unlock <name>' command first."
            )
          );
          process.exit(1);
        }
        return null;
      }

      const metadata = this.getSessionMetadata()!;

      // Get the stored password from the keychain
      const password = await keytar.getPassword(
        this.serviceName,
        metadata.accountName
      );

      if (!password) {
        await this.lockAccount();
        if (requireAccount) {
          console.log(
            chalk.yellow(
              "No active account session. Use 'account unlock' command first."
            )
          );
          process.exit(1);
        }
        return null;
      }

      // Load the account keys using the stored password
      const keys = await loadKeyFromStore(metadata.accountName, password);
      if (!keys) {
        await this.lockAccount();
        if (requireAccount) {
          throw new Error("Failed to load account. Please unlock again.");
        }
        return null;
      }

      return {
        keyPair: {
          privateKey: keys.privateKey,
          publicKey: keys.publicKey,
        },
        name: metadata.accountName,
        unlockTime: new Date(metadata.unlockTime),
      };
    } catch (error: any) {
      if (requireAccount) {
        throw error;
      }
      console.error(chalk.red(`Error loading account: ${error.message}`));
      return null;
    }
  }

  /**
   * @notice Lock the current account, removing the session
   * @return Promise that resolves when the account is locked
   */
  public async lockAccount(): Promise<void> {
    try {
      const metadata = this.getSessionMetadata();
      if (metadata) {
        // Remove the keychain entry with the password
        await keytar.deletePassword(this.serviceName, metadata.accountName);

        // Remove the session file
        if (fs.existsSync(this.sessionFile)) {
          fs.unlinkSync(this.sessionFile);
        }
      } else {
        throw new Error("No account is currently unlocked");
      }
    } catch (error: any) {
      console.error(chalk.red(`Error locking account: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * @notice Check if an account is currently unlocked
   * @return True if an account is unlocked, false otherwise
   */
  public async isAccountUnlocked(): Promise<boolean> {
    return await this.isSessionValid();
  }

  /**
   * @notice Get the name of the currently active account
   * @return The account name or null if no account is active
   */
  public getActiveAccountName(): string | null {
    const metadata = this.getSessionMetadata();
    return metadata ? metadata.accountName : null;
  }

  /**
   * @notice Remove an account from the session and keychain
   * @param accountName Name of the account to remove
   * @return Promise that resolves when the account is removed
   */
  public async removeAccount(accountName: string): Promise<void> {
    try {
      // Check if this account is currently unlocked
      const currentAccountName = this.getActiveAccountName();
      if (currentAccountName === accountName) {
        // Lock the account first
        await this.lockAccount();
      }

      // Remove any keychain entries for this account
      await keytar.deletePassword(this.serviceName, accountName);
    } catch (error: any) {
      console.error(chalk.red(`Error removing account: ${error.message}`));
    }
  }
}

// Export the singleton instance
export default SessionManager.getInstance();
