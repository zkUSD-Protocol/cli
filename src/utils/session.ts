import { Keypair, PrivateKey, PublicKey } from "o1js";
import chalk from "chalk";
import { loadKeyFromStore } from "./keystore.js";
import fs from "fs-extra";
import path from "path";
import os from "os";
import keytar from "keytar"; // For secure credential storage
import { KeyPair } from "@zkusd/core";

// Session file location (only stores non-sensitive metadata)
const SESSION_DIR = path.join(os.homedir(), ".zkusd", ".session");
const SESSION_FILE = path.join(SESSION_DIR, "current-session.json");

// Keychain service name
const SERVICE_NAME = "zkusd-cli-session";

/**
 * Interface representing session metadata
 */
interface SessionMetadata {
  accountName: string;
  unlockTime: string;
  publicKey: string;
}

/**
 * SessionManager is responsible for managing the state of unlocked accounts.
 */
class SessionManager {
  private static instance: SessionManager;
  private sessionTimeout: number = 30 * 60 * 1000; // 30 minutes default timeout

  private constructor() {
    // Ensure session directory exists
    fs.ensureDirSync(SESSION_DIR);
  }

  /**
   * Get the singleton instance of the SessionManager
   */
  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Set the session timeout in minutes
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
   * Save session metadata to file (no sensitive data)
   */
  private saveSessionMetadata(metadata: SessionMetadata): void {
    fs.writeJSONSync(SESSION_FILE, metadata, { spaces: 2 });
  }

  /**
   * Get current session metadata if exists
   */
  private getSessionMetadata(): SessionMetadata | null {
    if (!fs.existsSync(SESSION_FILE)) return null;

    try {
      return fs.readJSONSync(SESSION_FILE) as SessionMetadata;
    } catch (error) {
      return null;
    }
  }

  /**
   * Unlock an account and store its reference in the session
   * @param accountName Name of the account to unlock
   * @param password Password for the account
   * @returns True if the account was successfully unlocked
   */
  public async unlockAccount(
    accountName: string,
    password: string
  ): Promise<boolean> {
    // First verify the password works by trying to load the key
    const keys = await loadKeyFromStore(accountName, password);
    if (!keys) return false;

    // Store the name in the session metadata
    const metadata: SessionMetadata = {
      accountName,
      unlockTime: new Date().toISOString(),
      publicKey: keys.publicKey.toBase58(),
    };

    // Save the session metadata (contains NO private key)
    this.saveSessionMetadata(metadata);

    // Store the password in the keychain for later use
    await keytar.setPassword(SERVICE_NAME, accountName, password);

    console.log(
      chalk.green(`Account "${accountName}" is now unlocked and active`)
    );
    return true;
  }

  /**
   * Check if the session is valid and active
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
   * Get the active account for use in commands
   * @param requireAccount If true, will throw an error if no account is active
   * @returns The loaded account keys or null if none is active
   */
  public async getAccountForCommand(requireAccount: boolean = true): Promise<{
    keyPair: KeyPair;
    name: string;
    unlockTime: Date;
  } | null> {
    // Verify session is valid
    const isValid = await this.isSessionValid();
    if (!isValid) {
      if (requireAccount) {
        throw new Error(
          "No active account session. Use 'account unlock' command first."
        );
      }
      return null;
    }

    const metadata = this.getSessionMetadata()!;

    // Get the stored password from the keychain
    const password = await keytar.getPassword(
      SERVICE_NAME,
      metadata.accountName
    );

    if (!password) {
      await this.lockAccount();
      if (requireAccount) {
        throw new Error("Session password not found. Please unlock again.");
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
  }

  /**
   * Lock the current account, removing the session
   */
  public async lockAccount(): Promise<void> {
    const metadata = this.getSessionMetadata();
    if (metadata) {
      // Remove the keychain entry with the password
      await keytar.deletePassword(SERVICE_NAME, metadata.accountName);

      // Remove the session file
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
      }

      console.log(
        chalk.yellow(`Account "${metadata.accountName}" has been locked`)
      );
    }
  }

  /**
   * Check if an account is currently unlocked
   */
  public async isAccountUnlocked(): Promise<boolean> {
    return await this.isSessionValid();
  }

  /**
   * Get the name of the currently active account
   */
  public getActiveAccountName(): string | null {
    const metadata = this.getSessionMetadata();
    return metadata ? metadata.accountName : null;
  }
}

export default SessionManager.getInstance();
