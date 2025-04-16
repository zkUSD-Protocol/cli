/**
 * @title Lightnet Utilities
 * @notice Utilities for managing Lightnet configuration
 * @dev Provides functions for saving and retrieving Lightnet-specific settings
 */
import fs from "fs-extra";
import path from "path";
import os from "os";
import chalk from "chalk";

// Config directory and file paths
const CONFIG_DIR = path.join(os.homedir(), ".zkusd");
const CONFIG_FILE = path.join(CONFIG_DIR, ".lightnet.config.json");

// Interface for the configuration object
export interface LightnetConfig {
  priceProof?: {
    lightnet?: {
      price?: number;
    };
  };
}

/**
 * @notice Loads the lightnet configuration from disk
 * @return The current configuration object
 */
export function loadLightnetConfig(): LightnetConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return fs.readJSONSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error(chalk.yellow("Error reading config file, using defaults"));
  }
  return {};
}

/**
 * @notice Saves the lightnet configuration to disk
 * @param config The configuration object to save
 */
export function saveLightnetConfig(config: LightnetConfig): void {
  try {
    fs.ensureDirSync(CONFIG_DIR);
    fs.writeJSONSync(CONFIG_FILE, config, { spaces: 2 });
  } catch (error: any) {
    console.error(chalk.red(`Error saving configuration: ${error.message}`));
    throw error;
  }
}

/**
 * @notice Sets the price to use for lightnet price proofs
 * @param price The price value to set (in USD)
 * @return True if the price was set successfully, false otherwise
 */
export function setLightnetPrice(price: number): boolean {
  try {
    if (isNaN(price) || price <= 0) {
      throw new Error("Invalid price value: must be a positive number");
    }

    // Convert price to nanoUSD (9 decimal places)
    const nanoPrice = Math.floor(price * 1e9);

    // Load existing config
    const config = loadLightnetConfig();

    // Update the config with the new price (in nanoUSD)
    config.priceProof = config.priceProof || {};
    config.priceProof.lightnet = config.priceProof.lightnet || {};
    config.priceProof.lightnet.price = nanoPrice;

    // Save the updated config
    saveLightnetConfig(config);
    return true;
  } catch (error: any) {
    console.error(chalk.red(`Error setting lightnet price: ${error.message}`));
    return false;
  }
}

/**
 * @notice Gets the configured price for lightnet
 * @return The configured price in nanoUSD (9 decimal places)
 */
export function getLightnetPrice(): number {
  try {
    let nanoPrice: number | undefined;
    if (fs.existsSync(CONFIG_FILE)) {
      const config = fs.readJSONSync(CONFIG_FILE) as LightnetConfig;
      nanoPrice = config.priceProof?.lightnet?.price;

      if (!nanoPrice) {
        throw new Error("Price not set for lightnet");
      }
      return nanoPrice;
    } else {
      throw new Error("Config file not found");
    }
  } catch (error: any) {
    console.error(chalk.red(`\nError: ${error.message}`));
    console.error(
      chalk.yellow(
        "\nPlease run 'zkusd lightnet set-price' to configure the lightnet price"
      )
    );
    process.exit(1);
  }
}

/**
 * @notice Gets the human-readable price for display (in USD)
 * @return The price in USD (normal decimal representation)
 */
export function getDisplayPrice(): number {
  const nanoPrice = getLightnetPrice();
  return nanoPrice / 1e9;
}
