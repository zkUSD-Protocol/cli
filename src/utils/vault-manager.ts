import { VaultState, ZKUSDClient, ZkUsdEngineContract } from "@zkusd/core";
import { UnlockedAccount } from "./session.js";
import { PublicKey } from "o1js";
import chalk from "chalk";

interface VaultInfo {
  address: string;
  state: VaultState;
}

/**
 * @notice Fetches all vaults owned by the given account
 * @param account The unlocked account to check ownership for
 * @param engine The zkUSD engine contract instance
 * @returns Promise resolving to an array of owned vault addresses
 */
export async function listVaults(
  ownerAddress: string,
  client: ZKUSDClient
): Promise<VaultInfo[]> {
  try {
    // Get all events from the engine contract
    const events = await client.getEngine().fetchEvents();

    // Extract unique vault addresses owned by the current account
    const vaultAddresses = new Set<string>();
    const ownerPublicKey = ownerAddress;

    // Loop through events and find "CreateVault" events for the current account
    for (const event of events) {
      if (
        event.type === "NewVault" &&
        (event.event.data as any).owner.toBase58() === ownerPublicKey
      ) {
        vaultAddresses.add((event.event.data as any).vaultAddress.toBase58());
      }
    }

    // Create vault info objects
    const vaults: VaultInfo[] = [];

    for (const address of vaultAddresses) {
      try {
        // Try to fetch the vault state, but don't fail if we can't get it
        const state = await client.getVaultState(address);
        vaults.push({ address, state });
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
