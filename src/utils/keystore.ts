/**
 * @title Keystore Utilities
 * @notice Utilities for managing encrypted keystores for Mina accounts
 * @dev Handles the creation, storage, and loading of encrypted private keys
 */
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import os from "os";
import { PrivateKey, PublicKey } from "o1js";
import inquirer from "inquirer";
import chalk from "chalk";

/**
 * @notice Interface defining the structure of an encrypted keystore
 * @dev This is the JSON format saved to disk for each encrypted account
 */
interface Keystore {
  /** Friendly name for the account */
  name: string;
  /** AES-encrypted private key */
  encryptedKey: string;
  /** Salt used in key derivation */
  salt: string;
  /** Initialization vector for AES */
  iv: string;
  /** Base58 encoded public key */
  publicKey: string;
  /** Version of the keystore format */
  version: number;
}

/**
 * @title KeystoreManager
 * @notice Class to manage encrypted keystores for Mina accounts
 * @dev Implements encryption, saving, and loading keystore files
 */
export class KeystoreManager {
  /**
   * @notice Directory where keystores are saved
   * @dev Default location is ~/.zkusd/keystores
   */
  private readonly keystoreDir: string;

  /**
   * @notice Singleton instance of the KeystoreManager
   * @dev Used to implement the singleton pattern
   */
  private static instance: KeystoreManager;

  /**
   * @notice Private constructor to prevent direct instantiation
   * @param keystoreDir Optional custom directory to store keystores
   */
  private constructor(keystoreDir?: string) {
    this.keystoreDir =
      keystoreDir || path.join(os.homedir(), ".zkusd", "keystores");
    this.ensureKeystoreDir();
  }

  /**
   * @notice Get the singleton instance of KeystoreManager
   * @return The KeystoreManager instance
   */
  public static getInstance(): KeystoreManager {
    if (!KeystoreManager.instance) {
      KeystoreManager.instance = new KeystoreManager();
    }
    return KeystoreManager.instance;
  }

  /**
   * @notice Ensure the keystore directory exists
   * @dev Creates the directory if it doesn't exist
   */
  public ensureKeystoreDir(): void {
    fs.ensureDirSync(this.keystoreDir);
  }

  /**
   * @notice Import a private key and save it as an encrypted keystore
   * @param name Friendly name for the account
   * @param privateKeyBase58 Base58 encoded private key
   * @param password Password to encrypt the private key
   * @return Promise that resolves when the keystore is saved
   */
  public async importKey(
    name: string,
    privateKeyBase58: string,
    password: string
  ): Promise<void> {
    try {
      const keystorePath = path.join(this.keystoreDir, `${name}.json`);

      // Check if keystore with this name already exists
      if (fs.existsSync(keystorePath)) {
        console.error(
          chalk.red(`A keystore with the name "${name}" already exists.`)
        );
        return;
      }

      // Validate the private key
      let privateKey: PrivateKey;
      try {
        privateKey = PrivateKey.fromBase58(privateKeyBase58);
      } catch (error) {
        console.error(chalk.red("Invalid private key format."));
        return;
      }

      // Encrypt the private key
      const salt = crypto.randomBytes(16).toString("hex");
      const iv = crypto.randomBytes(16).toString("hex");
      const key = crypto.scryptSync(password, salt, 32);
      const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        key,
        Buffer.from(iv, "hex")
      );

      let encryptedKey = cipher.update(privateKeyBase58, "utf8", "hex");
      encryptedKey += cipher.final("hex");

      // Create keystore object
      const keystore: Keystore = {
        name,
        encryptedKey,
        salt,
        iv,
        publicKey: privateKey.toPublicKey().toBase58(),
        version: 1,
      };

      // Save to file
      fs.writeJSONSync(keystorePath, keystore, { spaces: 2 });

      console.log(chalk.green(`Keystore "${name}" created successfully.`));
      console.log(chalk.yellow("Public key:"), keystore.publicKey);
    } catch (error: any) {
      console.error(chalk.red(`Failed to import key: ${error.message}`));
    }
  }

  /**
   * @notice List all available keystores
   * @dev Displays names and public keys of all keystores
   */
  public listKeystores(): void {
    try {
      const files = fs.readdirSync(this.keystoreDir);
      const keystores = files.filter((file) => file.endsWith(".json"));

      if (keystores.length === 0) {
        console.log(chalk.yellow("No keystores found."));
        return;
      }

      console.log(chalk.cyan("Available wallets:"));

      keystores.forEach((file) => {
        try {
          const keystorePath = path.join(this.keystoreDir, file);
          const keystore = fs.readJSONSync(keystorePath) as Keystore;

          console.log(chalk.green(`- ${keystore.name}`));
          console.log(`  Public key: ${keystore.publicKey}`);
        } catch (error) {
          console.log(chalk.yellow(`- ${file} (could not read details)`));
        }
      });
    } catch (error: any) {
      console.error(chalk.red(`Failed to list keystores: ${error.message}`));
    }
  }

  /**
   * @notice Load a private key from a keystore file
   * @param name Name of the keystore to load
   * @param password Password to decrypt the keystore
   * @return Promise resolving to the keypair or null if loading fails
   */
  public async loadKeyFromStore(
    name: string,
    password: string
  ): Promise<{ privateKey: PrivateKey; publicKey: PublicKey } | null> {
    try {
      const keystorePath = path.join(this.keystoreDir, `${name}.json`);

      if (!fs.existsSync(keystorePath)) {
        console.error(chalk.red(`Keystore "${name}" not found.`));
        return null;
      }

      const keystore = fs.readJSONSync(keystorePath) as Keystore;

      try {
        const key = crypto.scryptSync(password, keystore.salt, 32);
        const decipher = crypto.createDecipheriv(
          "aes-256-cbc",
          key,
          Buffer.from(keystore.iv, "hex")
        );

        let decrypted = decipher.update(keystore.encryptedKey, "hex", "utf8");
        decrypted += decipher.final("utf8");

        const privateKey = PrivateKey.fromBase58(decrypted);
        const publicKey = privateKey.toPublicKey();

        return { privateKey, publicKey };
      } catch (error: any) {
        if (password) {
          // Only show error if user provided the password interactively
          console.error(chalk.red("Incorrect password or corrupted keystore."));
        }
        return null;
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to load key: ${error.message}`));
      return null;
    }
  }

  /**
   * @notice Remove a keystore file for a given account
   * @param name Name of the account to remove
   * @return True if the keystore was removed successfully, false otherwise
   */
  public removeKeystore(name: string): boolean {
    try {
      const keystorePath = path.join(this.keystoreDir, `${name}.json`);

      // Check if keystore exists
      if (!fs.existsSync(keystorePath)) {
        console.error(chalk.red(`Keystore "${name}" not found.`));
        return false;
      }

      // Delete the keystore file
      fs.unlinkSync(keystorePath);
      return true;
    } catch (error: any) {
      console.error(chalk.red(`Failed to remove keystore: ${error.message}`));
      return false;
    }
  }
}

/**
 * @notice Singleton instance of the KeystoreManager
 */
const keystoreManager = KeystoreManager.getInstance();

/**
 * @notice Create the keystore directory if it doesn't exist
 * @dev This function is called when the CLI starts
 */
export function checkAndCreateConfigDirs(): void {
  keystoreManager.ensureKeystoreDir();
}

/**
 * @notice Import a private key and save it as an encrypted keystore
 * @param name Friendly name for the account
 * @param privateKeyBase58 Base58 encoded private key
 * @param password Password to encrypt the private key
 * @return Promise that resolves when the keystore is saved
 */
export async function importKey(
  name: string,
  privateKeyBase58: string,
  password: string
): Promise<void> {
  return keystoreManager.importKey(name, privateKeyBase58, password);
}

/**
 * @notice List all available keystores
 * @dev Displays names and public keys of all keystores
 */
export function listKeystores(): void {
  keystoreManager.listKeystores();
}

/**
 * @notice Load a private key from a keystore file
 * @param name Name of the keystore to load
 * @param password Password to decrypt the keystore
 * @return Promise resolving to the keypair or null if loading fails
 */
export async function loadKeyFromStore(
  name: string,
  password: string
): Promise<{ privateKey: PrivateKey; publicKey: PublicKey } | null> {
  return keystoreManager.loadKeyFromStore(name, password);
}

/**
 * @notice Remove a keystore file for a given account
 * @param name Name of the account to remove
 * @return True if the keystore was removed successfully, false otherwise
 */
export function removeKeystore(name: string): boolean {
  return keystoreManager.removeKeystore(name);
}
