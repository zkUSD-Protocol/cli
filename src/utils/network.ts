import fs from "fs-extra";
import path from "path";
import os from "os";
import chalk from "chalk";

// Config directory for chain settings
const CONFIG_DIR = path.join(os.homedir(), ".zkusd");
const CHAIN_FILE = path.join(CONFIG_DIR, ".chain");

// Valid chain options
export const VALID_CHAINS = ["devnet", "lightnet", "mainnet"];

/**
 * Gets the currently configured chain
 * @returns The current chain name or the default if none is set
 */
export function getCurrentChain(): string | void {
  try {
    if (fs.existsSync(CHAIN_FILE)) {
      const chain = fs.readFileSync(CHAIN_FILE, "utf8").trim();
      if (VALID_CHAINS.includes(chain)) {
        return chain;
      }
    } else {
      console.log(
        chalk.yellow(
          "No network has been configured yet. Please use the 'zkusd network use <network>' command to configure a chain."
        )
      );
      process.exit(1);
    }
  } catch (error) {
    console.warn(chalk.yellow(`Could not read chain configuration`));
  }
}

/**
 * Sets the chain to use for all commands
 * @param chain Name of the chain to use
 * @returns true if successful, false otherwise
 */
export function setChain(chain: string): boolean {
  chain = chain.trim();
  try {
    // Validate the chain name
    if (!VALID_CHAINS.includes(chain)) {
      console.error(chalk.red(`Invalid chain: ${chain}`));
      console.error(
        chalk.yellow(`Valid options are: ${VALID_CHAINS.join(", ")}`)
      );
      return false;
    }

    // Ensure config directory exists
    fs.ensureDirSync(CONFIG_DIR);

    // Write the chain to the config file
    fs.writeFileSync(CHAIN_FILE, chain, { encoding: "utf8" });
    return true;
  } catch (error: any) {
    console.error(chalk.red(`Failed to set chain: ${error.message}`));
    return false;
  }
}
