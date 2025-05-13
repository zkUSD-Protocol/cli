/**
 * @title EngineUpdate Command Module
 * @notice Provides commands for creating, voting, submitting and executing zkUSD Engine‑update governance proposals.
 * @dev Refactored for clarity, robustness and stylistic parity with VaultCommand.
 */

import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";

import sessionManager from "../../utils/session.js";
import { getClient, getGovClient } from "../../utils/client.js";
import { getCurrentChain } from "../../utils/network.js";
import { ProofStore } from "../../utils/proof-store.js";
import { defaultEngineUpdateChainPreconditions } from "./default-chain-preconditions.js";

import {
  blockchain,
  EngineUpdateOperationFields,
  IZKUSDGovClient,
  ZKUSDClient,
  ZkusdUpdateProtocolState,
} from "@zkusd/core";
import {
  BoolOperation,
  FieldOperation,
  UInt64Operation,
  UInt8Operation,
} from "@zkusd/core";
import {
  EngineUpdateOperation,
  prettyPrintOperation,
} from "@zkusd/core";
import { Signature, Bool, UInt8, Gadgets, Field } from "o1js";
import { EngineUpdateVoteProof } from "@zkusd/core";
import { ProposalMap } from "@zkusd/core";
import { CouncilMap } from "@zkusd/core";
import { Seat } from "@zkusd/core";
import ora from "ora";

import { CommandBase } from "../base.js";
import { ZkusdProtocolPreconditions } from "@zkusd/core";
import { printErrorStack } from "../../utils/debug.js";

/** Convenience wrapper around ora for concise spinner handling */
async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora(text).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

interface GovernanceContext {
  chain: blockchain;
  client: ZKUSDClient;
  govClient: IZKUSDGovClient;
  currentState: ZkusdUpdateProtocolState;
  threshold: UInt8;
}

/**
 * Unified information attached to a local‑storage proposal.
 */
export type Proposal = {
  proof: EngineUpdateVoteProof;
  filename: string;
  proofHasUserVote?: boolean;
  proposalHasUserVote?: boolean;
  proofSupport: bigint;
  onchainSupport: bigint;
  totalSupport: bigint;
  voteMissing: number;
  canPass: boolean;
  isPassed: boolean;
};

export class EngineUpdateCommand extends CommandBase {
  constructor() {
    super("engine-update", "Engine update governance commands");
  }

  //───────────────────────────────────────────────────────────────────────────
  // Commander registration
  //───────────────────────────────────────────────────────────────────────────
  public register(program: Command): void {
    const cmd = program.command(this.name).description(this.description);

    this.registerCreateCommand(cmd);
    this.registerVoteCommand(cmd);
    this.registerSubmitCommand(cmd);
    this.registerExecuteCommand(cmd);
  }

  //───────────────────────────────────────────────────────────────────────────
  // Helpers
  //───────────────────────────────────────────────────────────────────────────

  /** Fetches chain, zkUSD client, gov‑client, current protocol state & vote threshold in a single round‑trip. */
  private async getGovernanceContext(): Promise<GovernanceContext> {
    return withSpinner("Fetching current protocol state...", async () => {
      const chain = getCurrentChain() as blockchain;
      const [client, govClient] = await Promise.all([
        getClient(false),
        getGovClient(),
      ]);

      const currentState = await client.buildProtocolState();
      const threshold =
        await govClient.councilContract.votePassThreshold.fetch();
      if (!threshold) {
        throw new Error("Failed to fetch vote pass threshold");
      }

      return { chain, client, govClient, currentState, threshold };
    });
  }

  /** Loads all locally stored engine‑update proofs. */
  private async getStoredProposals(): Promise<
    Map<string, EngineUpdateVoteProof>
  > {
    return withSpinner("Fetching stored proposals...", async () => {
      return ProofStore.getInstance().getEngineUpdateProposals();
    });
  }

  /** Counts support bits and determines pass‑status for a proposal. */
  private async enrichProposal(
    name: string,
    proof: EngineUpdateVoteProof,
    threshold: UInt8,
    userSeat: Seat | undefined,
    govClient: IZKUSDGovClient,
  ): Promise<Proposal> {
    const proofSupportBits = proof.publicOutput.cummulatedVoteBitArray;
    const proofSupport = ProposalMap.countBits(proofSupportBits);

    const proposalHash = proof.publicOutput.proposalHash;

    // On‑chain votes
    const proposalMap: ProposalMap = await govClient.data.proposalMap.get();
    const onchainSupportBits = proposalMap.get(proposalHash) ?? new Field(0);
    const onchainSupport = ProposalMap.countBits(onchainSupportBits);

    // Total votes = proof + on‑chain
    const totalSupportBits = ProposalMap.sumVotesProvably(
      proofSupportBits,
      onchainSupportBits,
    );
    const totalSupport = ProposalMap.countBits(totalSupportBits);

    const voteMissing = Math.max(
      0,
      Number(threshold.toBigInt() - totalSupport.toBigInt()),
    );

    // If enough support ⇒ verify inclusion in resolution tree.
    let isPassed = false;
    if (voteMissing === 0) {
      const resolutionTree = await govClient.data.resolutionTree.get();
      const resolutionWitness = resolutionTree.getWitnessWrapped(
        proof.publicInput.govResolutionIndex.toBigint(),
      );
      const computedRoot = resolutionWitness.calculateRoot(proposalHash);
      isPassed = computedRoot.equals(resolutionTree.getRoot()).toBoolean();
    }

    const proofHasUserVote = userSeat
      ? Gadgets.and(proofSupportBits, userSeat.value, CouncilMap.SEAT_LIMIT)
          .equals(userSeat.value)
          .toBoolean()
      : undefined;

    const proposalHasUserVote = userSeat
      ? Gadgets.and(proofSupportBits, userSeat.value, CouncilMap.SEAT_LIMIT)
          .equals(userSeat.value)
          .toBoolean()
      : undefined;

    return {
      proof,
      filename: name,
      proofSupport: proofSupport.toBigInt(),
      onchainSupport: onchainSupport.toBigInt(),
      totalSupport: totalSupport.toBigInt(),
      voteMissing,
      canPass: voteMissing === 0,
      isPassed,
      proofHasUserVote,
      proposalHasUserVote,
    };
  }
 
private printProposal(p: Proposal, threshold: bigint): void {
  const voteMissing = Math.max(0, Number(threshold - p.totalSupport));

  const status = p.isPassed
    ? chalk.green("Already passed")
    : p.canPass
    ? chalk.yellow("Can pass with on‑chain submission")
    : chalk.gray(`Needs ${voteMissing} vote(s) to pass`);

  const proofHasUserVoteString = p.proofHasUserVote
    ? chalk.green("Yes")
    : p.proofHasUserVote === false
    ? chalk.red("No")
    : chalk.gray("Unknown");

  const proposalHasUserVoteString = p.proposalHasUserVote
    ? chalk.green("Yes")
    : p.proposalHasUserVote === false
    ? chalk.red("No")
    : chalk.gray("Unknown");

  const leftColWidth1 = 43;
  const leftColWidth2 = 15;
  const leftColWidth3 = 18;

  const divider = (width: number) => chalk.cyan("  " + "─".repeat(width + 10));

  const printRow = (label: string, value: string, width: number) => {
    console.log(`  ${label.padEnd(width)} ${value}`);
  };

  console.log(chalk.bold(chalk.cyan(`\nEngine‑update proposal: ${p.filename}`)));
  console.log(divider(leftColWidth1));

  // Section: Account Votes
  console.log(chalk.bold("  Account Vote Status:"));
  printRow("• Proof file has the account's vote:", proofHasUserVoteString, leftColWidth1);
  printRow("• On-chain proposal has the account's vote:", proposalHasUserVoteString, leftColWidth1);
  console.log(divider(leftColWidth1));

  // Section: Proposal Status
  console.log(chalk.bold("  Proposal Status:"));
  printRow("• Status:", status, leftColWidth2);
  console.log(divider(leftColWidth1));

  // Section: Proposal Metadata
  console.log(chalk.bold("  Proposal Metadata:"));
  printRow("• Resolution #:", p.proof.publicInput.govResolutionIndex.toBigint().toString(), leftColWidth3);
  printRow("• Proposal hash:", p.proof.publicOutput.proposalHash.toString(), leftColWidth3);
  console.log(divider(leftColWidth1));

  // Section: Voting Summary
  console.log(chalk.bold("  Voting Summary:"));
  printRow("• Proof votes:", p.proofSupport.toString(), leftColWidth3);
  printRow("• On‑chain votes:", p.onchainSupport.toString(), leftColWidth3);
  printRow("• Total votes:", p.totalSupport.toString(), leftColWidth3);
  printRow("• Missing votes:", p.voteMissing.toString(), leftColWidth3);
  console.log(divider(leftColWidth1));

  // Section: Operations
  console.log(chalk.bold("  Operations:"));

  const rawOpLines = prettyPrintOperation(p.proof.publicInput.protocolUpdateOperation).split("\n");
  const maxContentWidth = Math.max(...rawOpLines.map(line => line.length));
  const opFrameWidth = maxContentWidth + 2;

  const opBorderTop = chalk.green("  ┌" + "─".repeat(opFrameWidth) + "┐");
  const opBorderBot = chalk.green("  └" + "─".repeat(opFrameWidth) + "┘");

  const framedOpLines = rawOpLines.map(line => {
    const paddedLine = line.padEnd(maxContentWidth, " ");
    return chalk.green("  │ ") + chalk.white(paddedLine) + chalk.green(" │");
  });

  console.log(opBorderTop);
  framedOpLines.forEach(line => console.log(line));
  console.log(opBorderBot);
}


  //───────────────────────────────────────────────────────────────────────────
  // Sub‑commands
  //───────────────────────────────────────────────────────────────────────────

  /** Interactively create & locally store a new proposal */
  private registerCreateCommand(parent: Command): void {
    parent
      .command("create")
      .description("Interactively create a new engine‑update proposal")
      .action(async () => {
        try {
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const { chain, currentState } = await this.getGovernanceContext();

          // Display current state
          console.log(chalk.cyan("\nCurrent zkUSD Protocol State:"));
          Object.entries(currentState).forEach(([k, v]) => {
            console.log(`- ${k}: ${v instanceof Bool ? v.toBoolean() : v}`);
          });

          //───────────────────────────────────────────
          // Prompt user for desired field changes
          //───────────────────────────────────────────
          const selectableFields: (keyof EngineUpdateOperationFields)[] = [
            "emergencyStop",
            "collateralRatio",
            "validPriceBlockCount",
            "liquidationBonusRatio",
            "oracleWhitelistHash",
            "configMerkleRoot",
            "vaultCreationDisabled",
            "vaultDebtCeiling",
          ];

          const { chosen } = await inquirer.prompt([
            {
              type: "checkbox",
              name: "chosen",
              message: "Which fields would you like to update?",
              choices: selectableFields,
              validate: (arr) =>
                arr.length === 0 ? "Select at least one field" : true,
            },
          ]);
          if (!chosen || chosen.length === 0) {
              console.log("Nothing selected. Exiting.");
              process.exit(0); // Exit cleanly
          }

          const updates: Partial<EngineUpdateOperationFields> = {};

          for (const field of chosen as (keyof EngineUpdateOperationFields)[]) {
            switch (field) {
              case "emergencyStop": {
                const { val } = await inquirer.prompt({
                  type: "confirm",
                  name: "val",
                  message: "Enable emergency stop?",
                  default: currentState.emergencyStop.toBoolean(),
                });
                if (val !== currentState.emergencyStop.toBoolean())
                  updates.emergencyStop = BoolOperation.set(val);
                break;
              }
              case "collateralRatio": {
                const { val } = await inquirer.prompt({
                  type: "number",
                  name: "val",
                  message: "Collateral ratio (%)",
                  default: currentState.collateralRatio.toBigInt(),
                });
                if (val !== currentState.collateralRatio.toBigInt())
                  updates.collateralRatio = UInt8Operation.set(val);
                break;
              }
              case "validPriceBlockCount": {
                const { val } = await inquirer.prompt({
                  type: "number",
                  name: "val",
                  message: "Valid price block count",
                  default: currentState.validPriceBlockCount.toBigInt(),
                });
                if (val !== currentState.validPriceBlockCount.toBigInt())
                  updates.validPriceBlockCount = UInt8Operation.set(val);
                break;
              }
              case "liquidationBonusRatio": {
                const { val } = await inquirer.prompt({
                  type: "number",
                  name: "val",
                  message: "Liquidation bonus ratio (%)",
                  default: currentState.liquidationBonusRatio.toBigInt(),
                });
                if (val !== currentState.liquidationBonusRatio.toBigInt())
                  updates.liquidationBonusRatio = UInt8Operation.set(val);
                break;
              }
              case "oracleWhitelistHash": {
                const { val } = await inquirer.prompt({
                  type: "input",
                  name: "val",
                  message: "Oracle whitelist hash",
                  default: currentState.oracleWhitelistHash.toString(),
                });
                if (val !== currentState.oracleWhitelistHash.toString())
                  updates.oracleWhitelistHash = FieldOperation.set(val);
                break;
              }
              case "configMerkleRoot": {
                const { val } = await inquirer.prompt({
                  type: "input",
                  name: "val",
                  message: "Config merkle root",
                  default: currentState.configMerkleRoot.toString(),
                });
                if (val !== currentState.configMerkleRoot.toString())
                  updates.configMerkleRoot = FieldOperation.set(val);
                break;
              }
              case "vaultCreationDisabled": {
                const { val } = await inquirer.prompt({
                  type: "confirm",
                  name: "val",
                  message: "Disable vault creation?",
                  default: currentState.vaultCreationDisabled.toBoolean(),
                });
                if (val !== currentState.vaultCreationDisabled.toBoolean())
                  updates.vaultCreationDisabled = BoolOperation.set(val);
                break;
              }
              case "vaultDebtCeiling": {
                const { val } = await inquirer.prompt({
                  type: "number",
                  name: "val",
                  message: "Vault debt ceiling (zkUSD)",
                  default: currentState.vaultDebtCeiling.toBigInt(),
                });
                if (val !== currentState.vaultDebtCeiling.toBigInt())
                  updates.vaultDebtCeiling = UInt64Operation.set(val);
                break;
              }
            }
          }

          // Build update spec & vote proof
          const govClient = await getGovClient();

          // nicely log that we're creating the spec
          const spec = await govClient.engineUpdate.createSpec({
            operation: EngineUpdateOperation.create(updates),
            protocolPreconditions: ZkusdProtocolPreconditions.always(),
            blockchainPreconditions:
              defaultEngineUpdateChainPreconditions(chain),
          });
          console.log(chalk.green("✓ Update spec created."));

          // nicely log that we're creating the vote proof
          console.log(chalk.gray("Creating vote proof..."));
          const proof = await govClient.engineUpdate.createVoteProof({
            updateSpec: spec,
            signature: Signature.create(
              account.keyPair.privateKey,
              spec.toFields(),
            ),
            seat: account.keyPair.publicKey,
          });

          console.log(
            chalk.green(
              "\n✓ Proposal created. Hash:",
              proof.publicOutput.proposalHash.toString(),
            ),
          );

          await this.saveProof(proof);
          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red(`Failed: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /** Browse stored proposals and cast a vote */
  private registerVoteCommand(parent: Command): void {
    parent
      .command("vote")
      .description("Browse and vote on stored proposals")
      .action(async () => {
        try {
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const { govClient, threshold } = await this.getGovernanceContext();

          const councilMap = await govClient.data.councilMap.get();
          const userSeat = councilMap.getPubkeySeatKey(
            account.keyPair.publicKey,
          );
          if (!userSeat) {
            console.log(
              chalk.yellow(
                "Key is not seated in governing council; cannot vote.",
              ),
            );
            return;
          }

          const stored = await this.getStoredProposals();
          const proposals = await Promise.all(
            [...stored.entries()].map(([name, proof]) =>
              this.enrichProposal(name, proof, threshold, userSeat, govClient),
            ),
          );

          proposals.forEach((p) => this.printProposal(p, threshold.toBigInt()));

          const voteable = proposals.filter(
            (p) => !p.isPassed && !p.proofHasUserVote && p.voteMissing > 0,
          );
          if (voteable.length === 0) {
            console.log(
              chalk.green("\nNo proposals require your vote right now."),
            );
            process.exit(0);
          }

          const { selected } = await inquirer.prompt({
            type: "list",
            name: "selected",
            message: "Choose a proposal to vote on:",
            choices: voteable.map((p) => ({ name: p.filename, value: p })),
          });
          const proposal: Proposal = selected;

          const signature = Signature.create(
            account.keyPair.privateKey,
            proposal.proof.publicInput.toFields(),
          );
          const newProof = await withSpinner("Creating vote proof...", () =>
            govClient.engineUpdate.createVoteProof({
              updateSpec: proposal.proof.publicInput,
              signature,
              seat: account.keyPair.publicKey,
            }),
          );

          const mergedProof = await withSpinner("Merging proofs...", () =>
            govClient.engineUpdate.mergeVoteProofs(proposal.proof, newProof),
          );

          await this.saveProof(mergedProof);
          console.log(chalk.green("✓ Vote stored locally. Submit when ready."));
          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red(`Failed: ${error.message}`));
          process.exit(1);
        }
      });
  }

  /** Submit a locally stored proposal that has not yet passed on‑chain */
  private registerSubmitCommand(parent: Command): void {
    parent
      .command("submit")
      .description("Submit an engine‑update proposal to chain (collect votes)")
      .action(async () => {
        try {
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const { govClient, threshold } = await this.getGovernanceContext();

          const stored = await this.getStoredProposals();
          const proposals = await Promise.all(
            [...stored.entries()].map(([n, p]) =>
              this.enrichProposal(n, p, threshold, undefined, govClient),
            ),
          );

          const waiting = proposals.filter((p) => !p.isPassed);
          if (waiting.length === 0) {
            console.log(
              chalk.green("All stored proposals are already passed."),
            );
            return;
          }

          const proposalName = (p: Proposal) =>{
            // gray suffix if missing votes
            const missingVotes = p.voteMissing > 0 ? chalk.gray(" (missing votes)") : "";
            const name = p.filename;
            let ret = name.length > 20 ? name.slice(0, 20) + "..." : name;
            ret += missingVotes;
            return ret;
          }

          const { selected } = await inquirer.prompt({
            type: "list",
            name: "selected",
            message: "Choose a proposal to submit:",
            choices: waiting.map((p) => ({ name: proposalName(p), value: p })),
          });
          const proposal: Proposal = selected;

          const res = await withSpinner("Submitting proposal...", () =>
            govClient.engineUpdate.submitVote(proposal.proof, account.keyPair),
          );

          if (!res.transactionIncluded) {
            throw new Error("Transaction not included: " + res.info);
          }
          // if some votes missing just print how many if not then
          // proceed to passing the proposal
          if (res.votesMissing !== undefined && res.votesMissing > 0) {
            console.log(
              chalk.green(
                `Submitted. Still missing ${res.votesMissing} vote(s).`,
              ),
            );
            process.exit(0);
          }

          // use client to pass the proposal
          // if proposal is not passed
          if (!proposal.isPassed) {
            const passRes = await withSpinner("Passing proposal...", () =>
              govClient.engineUpdate.tryPassProposal(proposal.proof.publicInput, account.keyPair),
            );

            if (!passRes.transactionIncluded) {
            throw new Error("Transaction not included: " + passRes.info);
          }

          console.log(
            chalk.green(
              "Proposal passed!",
            )
          )
          } else {
            console.log(
              chalk.green(
                "Proposal is already passed, force with force flag",
              ),
            );
          }

          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red(`Failed: ${error.message}`));
          printErrorStack(error);
          process.exit(1);
        }
      });
  }

  /** Execute an already‑passed proposal */
  private registerExecuteCommand(parent: Command): void {
    parent
      .command("execute")
      .description("Execute a passed engine‑update resolution on‑chain")
      .action(async () => {
        try {
          const account = await sessionManager.getAccountForCommand();
          if (!account) return;

          const { govClient, threshold } = await this.getGovernanceContext();

          const stored = await this.getStoredProposals();
          const proposals = await Promise.all(
            [...stored.entries()].map(([n, p]) =>
              this.enrichProposal(n, p, threshold, undefined, govClient),
            ),
          );

          const passed = proposals.filter((p) => p.isPassed);
          if (passed.length === 0) {
            console.log(
              chalk.yellow("No locally stored proposal is marked as passed."),
            );
            process.exit(0);
            return;
          }

          const { selected } = await inquirer.prompt({
            type: "list",
            name: "selected",
            message: "Choose a passed proposal to execute:",
            choices: passed.map((p) => ({ name: p.filename, value: p })),
          });
          const proposal: Proposal = selected;

          const res = await withSpinner("Executing proposal...", () =>
            govClient.engineUpdate.applyPassedProposal(
              proposal.proof.publicInput,
              account.keyPair,
            ),
          );

          if (!res.transactionIncluded) {
            throw new Error("Transaction not included: " + res.info);
          }

          console.log(chalk.green("✓ Proposal executed; engine updated."));
          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red(`Failed: ${error.message}`));
          process.exit(1);
        }
      });
  }

  //───────────────────────────────────────────────────────────────────────────
  // Utility
  //───────────────────────────────────────────────────────────────────────────

  private async saveProof(proof: EngineUpdateVoteProof): Promise<void> {
    const defaultName = proof.publicOutput.proposalHash.toString();
    const { name } = await inquirer.prompt({
      type: "input",
      name: "name",
      message: "Save proposal as:",
      default: defaultName,
    });

    ProofStore.getInstance().saveProof(proof, name);
    console.log(chalk.gray(`Proof stored under '${name}'.`));
  }
}

//───────────────────────────────────────────────────────────────────────────
// Factory
//───────────────────────────────────────────────────────────────────────────

export function register(program: Command): void {
  new EngineUpdateCommand().register(program);
}
