import {
  blockchain,
  MinaPriceInput,
  VaultState,
  ZKUSDClient,
  ZkUsdEngineContract,
} from "@zkusd/core";
import { UnlockedAccount } from "./session.js";
import { PublicKey } from "o1js";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { getCurrentChain } from "./network.js";
import { EventCache } from "./event-cache.js";

interface VaultInfo {
  address: string;
  state: VaultState;
  alias?: string; // Optional alias for the vault
}

interface VaultAliases {
  [network: string]: {
    [account: string]: {
      [alias: string]: string; // mapping from alias to vault address
    };
  };
}

// Directory for storing vault aliases
const CONFIG_DIR = path.join(os.homedir(), ".zkusd");
const VAULT_ALIASES_FILE = ".vaults.json";

/**
 * @notice Gets the path to the vault aliases file for the current network
 * @returns Path to the vault aliases file
 */
function getVaultAliasesPath(): string {
  const network = getCurrentChain();
  return path.join(CONFIG_DIR, `.${network}${VAULT_ALIASES_FILE}`);
}

/**
 * @notice Loads vault aliases from the filesystem
 * @returns The loaded vault aliases or an empty object if none exist
 */
function loadVaultAliases(): VaultAliases {
  const filePath = getVaultAliasesPath();

  try {
    if (fs.existsSync(filePath)) {
      return fs.readJSONSync(filePath) as VaultAliases;
    }
  } catch (error) {
    console.error(chalk.yellow("Error reading vault aliases, using defaults"));
  }

  return {};
}

/**
 * @notice Saves vault aliases to the filesystem
 * @param aliases The vault aliases to save
 */
function saveVaultAliases(aliases: VaultAliases): void {
  const filePath = getVaultAliasesPath();

  try {
    fs.ensureDirSync(CONFIG_DIR);
    fs.writeJSONSync(filePath, aliases, { spaces: 2 });
  } catch (error: any) {
    console.error(chalk.red(`Error saving vault aliases: ${error.message}`));
  }
}

/**
 * @notice Gets aliases for a specific account on the current network
 * @param accountPublicKey The account's public key
 * @returns Map of alias to vault address
 */
export function getAccountVaultAliases(accountPublicKey: string): {
  [alias: string]: string;
} {
  const aliases = loadVaultAliases();
  const network = getCurrentChain();

  if (!aliases[network]) {
    return {};
  }

  return aliases[network][accountPublicKey] || {};
}

/**
 * @notice Resolves a vault alias or address to a vault address
 * @param aliasOrAddress The vault alias or address to resolve
 * @param accountPublicKey The account's public key
 * @returns The resolved vault address or null if not found
 */
export function resolveVaultAlias(
  aliasOrAddress: string,
  accountPublicKey: string
): string | null {
  // If it's already a valid address, return it directly
  if (aliasOrAddress.length > 40) {
    // Assuming addresses are longer than aliases
    return aliasOrAddress;
  }

  const accountAliases = getAccountVaultAliases(accountPublicKey);
  return accountAliases[aliasOrAddress] || null;
}

/**
 * @notice Gets the alias for a vault address if one exists
 * @param vaultAddress The vault address
 * @param accountPublicKey The account's public key
 * @returns The alias for the vault or null if none exists
 */
export function getVaultAlias(
  vaultAddress: string,
  accountPublicKey: string
): string | null {
  const accountAliases = getAccountVaultAliases(accountPublicKey);

  for (const [alias, address] of Object.entries(accountAliases)) {
    if (address === vaultAddress) {
      return alias;
    }
  }

  return null;
}

/**
 * @notice Sets an alias for a vault address
 * @param alias The alias to set
 * @param vaultAddress The vault address
 * @param accountPublicKey The account's public key
 * @returns True if the alias was set successfully
 */
export function setVaultAlias(
  alias: string,
  vaultAddress: string,
  accountPublicKey: string
): boolean {
  try {
    const aliases = loadVaultAliases();
    const network = getCurrentChain();

    if (!network) {
      throw new Error("No network found");
    }

    // Initialize network and account objects if they don't exist
    if (!aliases[network]) {
      aliases[network] = {};
    }

    if (!aliases[network][accountPublicKey]) {
      aliases[network][accountPublicKey] = {};
    }

    // Set the alias
    aliases[network][accountPublicKey][alias] = vaultAddress;

    // Save the updated aliases
    saveVaultAliases(aliases);
    return true;
  } catch (error: any) {
    console.error(chalk.red(`Error setting vault alias: ${error.message}`));
    return false;
  }
}

/**
 * @notice Removes an alias for a vault address
 * @param alias The alias to remove
 * @param accountPublicKey The account's public key
 * @returns True if the alias was removed successfully
 */
export function removeVaultAlias(
  alias: string,
  accountPublicKey: string
): boolean {
  try {
    const aliases = loadVaultAliases();
    const network = getCurrentChain();

    if (!aliases[network] || !aliases[network][accountPublicKey]) {
      return false;
    }

    // Check if alias exists
    if (!aliases[network][accountPublicKey][alias]) {
      return false;
    }

    // Remove the alias
    delete aliases[network][accountPublicKey][alias];

    // Save the updated aliases
    saveVaultAliases(aliases);
    return true;
  } catch (error: any) {
    console.error(chalk.red(`Error removing vault alias: ${error.message}`));
    return false;
  }
}

/**
 * @notice Fetches all vaults owned by the given account
 * @param ownerAddress The address of the vault owner
 * @param client The ZKUSD client instance
 * @returns Promise resolving to an array of owned vault info
 */
export async function listVaults(
  ownerAddress: string,
  client: ZKUSDClient
): Promise<VaultInfo[]> {
  try {
    // Create an event cache instance
    const eventCache = new EventCache(client);

    // Get all events from the engine contract with caching
    const events = await eventCache.fetchEvents();

    // Extract unique vault addresses owned by the current account
    const vaultAddresses = new Set<string>();
    const ownerPublicKey = ownerAddress;

    // Loop through events and find "NewVault" events for the current account
    for (const event of events) {
      if (
        event.type === "NewVault" &&
        (event.event.data as any).owner === ownerPublicKey
      ) {
        vaultAddresses.add((event.event.data as any).vaultAddress);
      }
    }

    // Create vault info objects
    const vaults: VaultInfo[] = [];

    for (const address of vaultAddresses) {
      try {
        // Try to fetch the vault state, but don't fail if we can't get it
        const state = await client.getVaultState(address);

        // Get alias if one exists
        const alias = getVaultAlias(address, ownerPublicKey);

        vaults.push({ address, state, alias: alias || undefined });
      } catch (error) {
        console.error(chalk.red(`Error fetching vault state for: ${address}`));
        continue;
      }
    }

    return vaults;
  } catch (error: any) {
    console.error(chalk.red(`Error listing vaults: ${error.message}`));
    return [];
  }
}

/**
 * @notice Filters vaults by their health factor
 * @dev Fetches all vaults and filters based on comparison with a health factor threshold
 * @param client The ZKUSD client instance
 * @param operator The comparison operator ('lt' or 'gt')
 * @param threshold The health factor threshold value
 * @param priceProof The price proof to use for health factor calculations
 * @return Promise resolving to an array of matching vault information
 */
export async function listVaultsByHealthFactor(
  client: ZKUSDClient,
  operator: "lt" | "gt",
  threshold: number,
  priceProof: MinaPriceInput
): Promise<
  {
    address: string;
    healthFactor: number;
    owner: string;
    collateral: string;
    debt: string;
  }[]
> {
  // Get the event cache
  const eventCache = new EventCache(client);

  // Fetch all events
  const events = await eventCache.fetchEvents();

  // Process events to find unique vault addresses
  const vaultAddresses = new Set<string>();

  for (const event of events) {
    if (event.type === "NewVault") {
      const vaultAddress = event.event.data.vaultAddress;
      vaultAddresses.add(
        typeof vaultAddress === "string"
          ? vaultAddress
          : vaultAddress.toBase58()
      );
    }
  }

  // Analyze each vault's health factor
  const matchingVaults: {
    address: string;
    healthFactor: number;
    owner: string;
    collateral: string;
    debt: string;
  }[] = [];

  for (const address of vaultAddresses) {
    try {
      // Get vault state
      const vaultState = await client.getVaultState(address);

      // Skip empty vaults (no debt)
      if (vaultState.debtAmount.toBigInt() === 0n) {
        continue;
      }

      // Calculate health factor
      const healthFactor = await client.getVaultHealthFactor(
        address,
        priceProof
      );

      // Check if health factor meets the criteria
      const meetsCondition =
        (operator === "lt" && healthFactor < threshold) ||
        (operator === "gt" && healthFactor > threshold);

      if (meetsCondition) {
        matchingVaults.push({
          address,
          healthFactor,
          owner: vaultState.owner
            ? typeof vaultState.owner === "string"
              ? vaultState.owner
              : vaultState.owner.toBase58()
            : "Unknown",
          collateral: (
            Number(vaultState.collateralAmount.toBigInt()) / 1e9
          ).toFixed(2),
          debt: (Number(vaultState.debtAmount.toBigInt()) / 1e9).toFixed(2),
        });
      }
    } catch (error) {
      // Skip vaults we can't analyze
      continue;
    }
  }

  // Sort vaults by health factor (ascending for lt, descending for gt)
  matchingVaults.sort((a, b) => {
    return operator === "lt"
      ? a.healthFactor - b.healthFactor // ascending for lt
      : b.healthFactor - a.healthFactor; // descending for gt
  });

  return matchingVaults;
}

/**
 * @notice Finds vaults that are eligible for liquidation (health factor < 100)
 * @dev Convenience wrapper around listVaultsByHealthFactor for liquidatable vaults
 * @param client The ZKUSD client instance
 * @param priceProof The price proof to use for health factor calculations
 * @return Promise resolving to an array of liquidatable vault information
 */
export async function findLiquidatableVaults(
  client: ZKUSDClient,
  priceProof: MinaPriceInput
): Promise<
  {
    address: string;
    healthFactor: number;
    owner: string;
    collateral: string;
    debt: string;
  }[]
> {
  return listVaultsByHealthFactor(client, "lt", 100, priceProof);
}
