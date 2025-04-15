import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import os from "os";
import { PrivateKey, PublicKey } from "o1js";
import inquirer from "inquirer";
import chalk from "chalk";

const KEYSTORE_DIR = path.join(os.homedir(), ".zkusd", "keystores");

export function checkAndCreateConfigDirs(): void {
  fs.ensureDirSync(KEYSTORE_DIR);
}

interface Keystore {
  name: string;
  encryptedKey: string;
  salt: string;
  iv: string;
  publicKey: string;
  version: number;
}

export async function importKey(
  name: string,
  privateKeyBase58: string,
  password: string
): Promise<void> {
  try {
    const keystorePath = path.join(KEYSTORE_DIR, `${name}.json`);

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

export function listKeystores(): void {
  try {
    const files = fs.readdirSync(KEYSTORE_DIR);
    const keystores = files.filter((file) => file.endsWith(".json"));

    if (keystores.length === 0) {
      console.log(chalk.yellow("No keystores found."));
      return;
    }

    console.log(chalk.cyan("Available wallets:"));

    keystores.forEach((file) => {
      try {
        const keystorePath = path.join(KEYSTORE_DIR, file);
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

export async function loadKeyFromStore(
  name: string,
  password: string
): Promise<{ privateKey: PrivateKey; publicKey: PublicKey } | null> {
  try {
    const keystorePath = path.join(KEYSTORE_DIR, `${name}.json`);

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
      if (!password) {
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
