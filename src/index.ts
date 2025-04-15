#!/usr/bin/env node
import { Command } from "commander";
import { checkAndCreateConfigDirs } from "./utils/keystore.js";
import * as accountCommands from "./commands/account.js";
import * as proverCommands from "./commands/prover.js";
import * as networkCommands from "./commands/network.js";
import * as vaultCommands from "./commands/vault.js";

// Ensure config directories exist
checkAndCreateConfigDirs();

const program = new Command();

program
  .name("zkusd")
  .description("CLI tool for interacting with the Fizk Protocol");

// Register subcommands
accountCommands.register(program);
proverCommands.register(program);
networkCommands.register(program);
vaultCommands.register(program);
program.parse(process.argv);
