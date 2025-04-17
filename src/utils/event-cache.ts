/**
 * @title Event Cache Utility
 * @notice Provides caching mechanism for protocol events to improve performance
 * @dev Caches events locally and incrementally fetches only new events
 */
import fs from "fs-extra";
import path from "path";
import os from "os";
import { UInt32, fetchLastBlock } from "o1js";
import { ZKUSDClient, blockchain } from "@zkusd/core";
import { getCurrentChain } from "./network.js";
import chalk from "chalk";

// Event cache directory structure
const CONFIG_DIR = path.join(os.homedir(), ".zkusd");
const CACHE_DIR = path.join(CONFIG_DIR, "cache");
const EVENT_CACHE_FILE = (network: string) =>
  path.join(CACHE_DIR, `${network}-events.json`);
const LAST_BLOCK_FILE = (network: string) =>
  path.join(CACHE_DIR, `${network}-last-block.json`);

// Interface for cached event data
interface EventCacheData {
  events: any[];
  lastUpdated: string;
}

// Interface for last block data
interface LastBlockData {
  blockHeight: number;
  timestamp: string;
}

/**
 * @notice Manages caching and retrieval of protocol events
 * @dev Implements caching strategy based on network type
 */
export class EventCache {
  private network: blockchain;
  private client: ZKUSDClient;
  private cacheEnabled: boolean;

  /**
   * @notice Constructor for event cache
   * @param client ZKUSD client instance
   */
  constructor(client: ZKUSDClient) {
    this.client = client;
    this.network = getCurrentChain() as blockchain;

    // Enable caching only for devnet and mainnet
    this.cacheEnabled = this.network === "devnet" || this.network === "mainnet";

    // Ensure cache directory exists
    fs.ensureDirSync(CACHE_DIR);
  }

  /**
   * @notice Fetches events with caching based on network
   * @return Promise resolving to all events
   */
  async fetchEvents(): Promise<any[]> {
    // For lightnet or if caching is disabled, just fetch all events
    if (!this.cacheEnabled || this.network === "lightnet") {
      const events = await this.client.getEngine().fetchEvents();
      return JSON.parse(JSON.stringify(events));
    }

    try {
      // Get the current block height
      const { blockchainLength } = await fetchLastBlock();
      const currentBlockHeight = UInt32.from(blockchainLength);

      // Get the last processed block
      const lastBlockData = this.getLastProcessedBlock();

      // If lastBlockData is null, this is our first run
      if (!lastBlockData) {
        // Fetch all events from the beginning
        const newEvents = await this.client.getEngine().fetchEvents();

        // Save the events and current block height
        this.saveEventCache(newEvents);
        this.saveLastProcessedBlock(Number(currentBlockHeight.toString()));
      }
      // Check if we need to fetch new events (current block > last processed block)
      else if (
        Number(currentBlockHeight.toString()) > lastBlockData.blockHeight
      ) {
        // Fetch only new events from the last processed block
        const newEvents = await this.client
          .getEngine()
          .fetchEvents(UInt32.from(lastBlockData.blockHeight));

        // Load existing cached events
        const cachedEvents = this.loadEventCache().events;

        // Merge with existing events, removing duplicates
        const mergedEvents = this.mergeEvents(cachedEvents, newEvents);

        // Save merged events and update last processed block
        this.saveEventCache(mergedEvents);
        this.saveLastProcessedBlock(Number(currentBlockHeight.toString()));
      }

      // Always return events from cache to ensure consistent data types
      return this.loadEventCache().events;
    } catch (error: any) {
      console.error(chalk.red(`Error fetching events: ${error.message}`));

      // On error, fall back to non-cached approach
      return await this.client.getEngine().fetchEvents();
    }
  }
  /**
   * @notice Merges existing and new events, avoiding duplicates
   * @param existing Existing cached events
   * @param newEvents Newly fetched events
   * @return Combined list with no duplicates
   */
  private mergeEvents(existing: any[], newEvents: any[]): any[] {
    // Create a set of existing transaction hashes
    const existingHashes = new Set(
      existing.map((event) => event.event.transactionInfo.transactionHash)
    );

    // Filter out duplicates and add new events
    const uniqueNewEvents = newEvents.filter(
      (event) =>
        !existingHashes.has(event.event.transactionInfo.transactionHash)
    );

    return [...existing, ...uniqueNewEvents];
  }

  /**
   * @notice Saves event cache to disk
   * @param events The events to cache
   */
  private saveEventCache(events: any[]): void {
    const cacheData: EventCacheData = {
      events,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeJSONSync(EVENT_CACHE_FILE(this.network), cacheData, { spaces: 2 });
  }

  /**
   * @notice Loads event cache from disk
   * @return The cached event data
   */
  private loadEventCache(): EventCacheData {
    try {
      return fs.readJSONSync(EVENT_CACHE_FILE(this.network)) as EventCacheData;
    } catch (error) {
      return { events: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * @notice Saves the last processed block height
   * @param blockHeight The block height to save
   */
  private saveLastProcessedBlock(blockHeight: number): void {
    const blockData: LastBlockData = {
      blockHeight,
      timestamp: new Date().toISOString(),
    };

    fs.writeJSONSync(LAST_BLOCK_FILE(this.network), blockData, { spaces: 2 });
  }

  /**
   * @notice Gets the last processed block height
   * @return The last block data or null if not available
   */
  private getLastProcessedBlock(): LastBlockData | null {
    try {
      if (fs.existsSync(LAST_BLOCK_FILE(this.network))) {
        return fs.readJSONSync(LAST_BLOCK_FILE(this.network)) as LastBlockData;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * @notice Clears the event cache for the current network
   */
  public clearCache(): void {
    try {
      if (fs.existsSync(EVENT_CACHE_FILE(this.network))) {
        fs.unlinkSync(EVENT_CACHE_FILE(this.network));
      }
      if (fs.existsSync(LAST_BLOCK_FILE(this.network))) {
        fs.unlinkSync(LAST_BLOCK_FILE(this.network));
      }
      console.log(chalk.green(`Cache cleared for ${this.network}`));
    } catch (error: any) {
      console.error(chalk.red(`Error clearing cache: ${error.message}`));
    }
  }
}
