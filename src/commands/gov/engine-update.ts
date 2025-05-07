import inquirer from 'inquirer';
import { Command } from "commander";
import { CommandBase } from "../base";
import sessionManager, { UnlockedAccount } from "../../utils/session.js";
import { getClient, getGovClient } from "../../utils/client.js";
import { blockchain, EngineUpdateOperationFields, IZKUSDGovClient, ZKUSDGovClient, ZkusdUpdateProtocolState } from "@zkusd/core";
import { Bool, Field, UInt8, UInt64, Signature, Gadgets } from "o1js";
import chalk from "chalk";
import ora from "ora";
import { BoolOperation, FieldOperation, UInt64Operation, UInt8Operation } from '@zkusd/core/build/src/system/engine-update/simple-operations';
import { EngineUpdateOperation, prettyPrintOperation } from '@zkusd/core/build/src/system/engine-update/operation';
import { ZkusdProtocolPreconditions } from '@zkusd/core/build/src/system/engine-update/protocol-preconditions';
import { MinaChainPreconditions } from '@zkusd/core/build/src/system/engine-update/blockchain-preconditions';
import { defaultEngineUpdateChainPreconditions } from './default-chain-preconditions';
import { getCurrentChain } from '../../utils/network';
import { EngineUpdateVoteProof } from '@zkusd/core/build/src/proofs/engine-update/prove';
import { config } from 'dotenv';
import { ProofStore } from '../../utils/proof-store';
import { ProposalMap } from '@zkusd/core/build/src/system/council/data/proposal-merkle-map';
import { CouncilMap } from '@zkusd/core/build/src/system/council/data/council-map';
import { Seat } from '@zkusd/core/build/src/system/council/seat';


    type Proposal = {
      proof: EngineUpdateVoteProof;
      filename: string; 
      hasUserSupport: boolean | undefined;
      proofSupport: bigint;
      onchainSupport: bigint;
      totalSupport: bigint;
      voteMissing: number;
      canPass: boolean;
      isPassed: boolean;
    };

export class EngineUpdateCommand extends CommandBase {
    constructor(){
        super("engine-update", "Engine update governance commands.")
    }

    public register(program: Command): void {
        const command = program.command(this.name).description(this.description);

        this.registerCreateCommand(command);
        this.registerVoteCommand(command);
        this.registerSubmitCommand(command);
        this.registerExecuteResolutionCommand(command);
    }
    private registerExecuteResolutionCommand(parentCommand: Command) {
      parentCommand
        .command("execute")
        .description("Execute an engine update resolution")
        .action(async () => {
          const account = await sessionManager.getAccountForCommand();
        if (!account) {
          console.log("No account selected.");
          return;
        }

          let spinner = ora("Fetching current protocol state...").start();
          let chain;
          let client;
          let govClient;
          let current;
          let threshold;
          try {
            chain = getCurrentChain() as blockchain;
            client = await getClient(false);
            govClient = await getGovClient();
            current = client.getEngine().buildProtocolState();
            threshold = await govClient.councilContract.votePassThreshold.fetch()
            spinner.succeed("Fetched current protocol state");
            
          } catch (error) {
            spinner.fail("Failed to fetch current protocol state");
            console.error(error);
            return;
          }
          if (!chain || !client || !govClient || !current || !threshold) {
            console.error("Could not initialize clients.");
            return;
          }

          // browse all passed proposals
          let storedProposals;
          spinner = ora("Fetching stored proposals...").start();
          try{
            storedProposals = await ProofStore.getInstance().getEngineUpdateProposals();
            spinner.succeed("Fetched stored proposals");
          } catch (error) {
            spinner.fail("Failed to fetch stored proposals");
            console.error(error);
            return;
          }
          if (!storedProposals) {
            console.error("Could not fetch stored proposals.");
            return;
          }

          const proposals = await Promise.all(storedProposals.entries().map(([name, proof]) => this.parseProposal(name, proof, threshold, undefined, govClient)));
          // filter out proposals that are not passed
          const passedProposals = proposals.filter((proposal) => proposal.isPassed);
          // user inquirer to list notPassedProposals for the user to choose
          const { proposal } = await inquirer.prompt([
            {
              type: "list",
              name: "proposal",
              message: "Choose a passed proposal to execute",
              choices: passedProposals.map((proposal) => proposal.filename),
            },
          ]);
          if (!proposal) {
            console.log("No proposal selected.");
            return;
          }

          // use the unlocked account as a sender
          const senderKeys = account.keyPair;
          // use govclient to submit the proposal
          
          try{
          spinner = ora("Executing proposal...").start();
          const result = await govClient.engineUpdate.applyPassedProposal(proposal.proof, senderKeys)
          spinner.succeed("Executed proposal");
          if(!result.transactionIncluded){
            throw new Error(`Transaction not included. Info: ${result.info}`);
          } else{
            console.log("Transaction included. Proposal executed. Engine updated.");
          }
          } catch (error) {
            spinner.fail("Failed to execute proposal");
            console.error(error);
            return;
          }
        });
    }
      
    private registerSubmitCommand(parentCommand: Command) {
      parentCommand
        .command("submit")
        .description("Submit an engine update proposal")
        .action(async () => {
        const account = await sessionManager.getAccountForCommand();
        if (!account) {
          console.log("No account selected.");
          return;
        }

          let spinner = ora("Fetching current protocol state...").start();
          let chain;
          let client;
          let govClient;
          let current;
          let threshold;
          try {
            chain = getCurrentChain() as blockchain;
            client = await getClient(false);
            govClient = await getGovClient();
            current = client.getEngine().buildProtocolState();
            threshold = await govClient.councilContract.votePassThreshold.fetch()
            spinner.succeed("Fetched current protocol state");
            
          } catch (error) {
            spinner.fail("Failed to fetch current protocol state");
            console.error(error);
            return;
          }
          if (!chain || !client || !govClient || !current || !threshold) {
            console.error("Could not initialize clients.");
            return;
          }

          // browse all not yet passed proposals
          let storedProposals;
          spinner = ora("Fetching stored proposals...").start();
          try{
            storedProposals = await ProofStore.getInstance().getEngineUpdateProposals();
            spinner.succeed("Fetched stored proposals");
          } catch (error) {
            spinner.fail("Failed to fetch stored proposals");
            console.error(error);
            return;
          }
          if (!storedProposals) {
            console.error("Could not fetch stored proposals.");
            return;
          }

          const proposals = await Promise.all(storedProposals.entries().map(([name, proof]) => this.parseProposal(name, proof, threshold, undefined, govClient)));
          // filter out proposals that are not passed
          const notPassedProposals = proposals.filter((proposal) => !proposal.isPassed);
          // user inquirer to list notPassedProposals for the user to choose
          const { proposal } = await inquirer.prompt([
            {
              type: "list",
              name: "proposal",
              message: "Choose a proposal to submit",
              choices: notPassedProposals.map((proposal) => proposal.filename),
            },
          ]);
          if (!proposal) {
            console.log("No proposal selected.");
            return;
          }

          // use the unlocked account as a sender
          const senderKeys = account.keyPair;
          // use govclient to submit the proposal
          
          try{
          spinner = ora("Submitting proposal...").start();
          const result = await govClient.engineUpdate.submitVote(proposal.proof, senderKeys)
          spinner.succeed("Submitted proposal");
          if(!result.transactionIncluded){
            throw new Error(`Transaction not included. Info: ${result.info}`);
          } else if(result.votesMissing){
            console.log(`Transaction included. Votes missing: ${result.votesMissing}`);
          } else{
            console.log("Transaction included. Proposal passed.");
          }
          } catch (error) {
            spinner.fail("Failed to submit proposal");
            console.error(error);
            return;
          }
        });
    }
    private registerVoteCommand(parentCommand: Command) {
      parentCommand
        .command("vote")
        .description("Browse and vote on stored proposals")
        .action(async () => {

          let spinner = ora("Fetching current protocol state...").start();
          let chain;
          let client;
          let govClient;
          let current;
          let threshold;
          try {
            chain = getCurrentChain() as blockchain;
            client = await getClient(false);
            govClient = await getGovClient();
            current = client.getEngine().buildProtocolState();
            threshold = await govClient.councilContract.votePassThreshold.fetch()
            spinner.succeed("Fetched current protocol state");
            
          } catch (error) {
            spinner.fail("Failed to fetch current protocol state");
            console.error(error);
            return;
          }
          if (!chain || !client || !govClient || !current || !threshold) {
            console.error("Could not initialize clients.");
            return;
          }

          spinner = ora("Fetching stored proposals...").start();
          // give a nice list of stored proposals
          let storedProposals;
          try{
            storedProposals = await ProofStore.getInstance().getEngineUpdateProposals();
            spinner.succeed("Fetched stored proposals");

          } catch (error) {
            spinner.fail("Failed to fetch stored proposals");
            console.error(error);
            return;
          }
          if (!storedProposals) {
            console.error("Could not fetch stored proposals.");
            return;
          }  

        const account = await sessionManager.getAccountForCommand();
        if (!account) {
          console.log("No account selected.");
          return;
        }

        // get the user council seat or exit with a message if not seated
        const councilMap = await govClient.data.councilMap.get();
        const userSeat = councilMap.getPubkeySeatKey(account.keyPair.publicKey);
        if (!userSeat) {
          console.log("Cannot vote on proposals as the used key does not seat in the governing council.");
          return;
        }

          const proposals = await Promise.all(storedProposals.entries().map(([name, proof]) => this.parseProposal(name, proof, threshold, userSeat, govClient)));

          proposals.forEach((proposal) => {
            this.printProposal(proposal, threshold.toBigInt());
          });

          // now all of the proposals that can pass and have some votes missing
          const proposalsToPass = proposals.filter((proposal) => proposal.isPassed === false && proposal.hasUserSupport === false && proposal.voteMissing > 0);
          // user inquirer to list proposalsToPass for the user to choose
          // or they can choose to exit
          const { proposal } = await inquirer.prompt([
            {
              type: "list",
              name: "proposal",
              message: "Choose a proposal to vote on",
              choices: proposalsToPass.map((proposal) => proposal.filename),
            },
          ]);

          // if proposal was selected for voting get the cli user account
          if (!proposal) {
            console.log("No proposal selected.");
            return;
          }


          // use client to vote on the proposal
          // create signature for the update spec
          spinner = ora("Creating vote proof...").start();  
          let newProof: EngineUpdateVoteProof;
          try {
            const signature = Signature.create(account.keyPair.privateKey, proposal.proof.publicInput.toFields());
            newProof = await govClient.engineUpdate.createVoteProof(
              {
                updateSpec: proposal.proof,
                signature,
              seat: account.keyPair.publicKey
            }
          );
          spinner.succeed("Created vote proof");
          } catch (error) {
            spinner.fail("Failed to create vote proof");
            console.error(error);
            return;
          } 

          // merge new vote proof ggj
          spinner = ora("Merging vote proof...").start();
          let mergeProof: EngineUpdateVoteProof;
          try {   
            mergeProof = await govClient.engineUpdate.mergeVoteProofs(proposal.proof, newProof);
            spinner.succeed("Merged vote proof");
          } catch (error) {
            spinner.fail("Failed to merge vote proof");
            console.error(error);
            return;
          }
          
          // prompt for a name for the proof and store it then log the location if succeeded
          try {
            await saveProof(mergeProof);
            console.log("Proof stored successfully.");
          } catch (error) {
            console.error("Failed to save proof.");
            console.error(error);
            return;
          }

        });
    }

    //split the function to parsing and printing
    private async parseProposal(name: string, proof: EngineUpdateVoteProof, threshold: UInt8, userSeat: Seat | undefined, govClient: IZKUSDGovClient ) : Promise<Proposal> {
      const spec = proof.publicInput;
      const proofSupportBits = proof.publicOutput.cummulatedVoteBitArray;
      const proofSupport = ProposalMap.countBits(proofSupportBits);
      const resolutionIndex = proof.publicInput.govResolutionIndex.toBigint();
      const proposalHash = proof.publicOutput.proposalHash;
      const proposalMap = await govClient.data.proposalMap.get();
      const onchainSupportBits = proposalMap.get(proposalHash);
      const onchainSupport = ProposalMap.countBits(onchainSupportBits);
      const totalSupportBits = ProposalMap.sumVotesProvably(proofSupportBits, onchainSupportBits);
      const totalSupport = ProposalMap.countBits(totalSupportBits);
      const voteMissing = Math.max(0, Number( threshold.toBigInt() - totalSupport.toBigInt()));
      const canPass: boolean = voteMissing === 0;
      let isPassed = false;
      if(canPass){
        // check if is passed
        const resolutionTree = await govClient.data.resolutionTree.get();
        const resolutionWitness = await resolutionTree.getWitnessWrapped(resolutionIndex);
        const computedRoot = resolutionWitness.calculateRoot(proposalHash);
        isPassed = computedRoot.equals(resolutionTree.getRoot()).toBoolean();
      }

      let hasUserSupport: boolean | undefined;
      if (!userSeat) {
        console.log("User is not seated.");
        hasUserSupport = undefined;
      } else {
        hasUserSupport = Gadgets.and(proofSupportBits, userSeat.value, (CouncilMap.SEAT_LIMIT)).equals(userSeat.value).toBoolean();
      }
      
      return {
        proof,
        filename: name,
        proofSupport: proofSupport.toBigInt(),
        onchainSupport: onchainSupport.toBigInt(),
        totalSupport: totalSupport.toBigInt(),
        canPass,
        isPassed,
        hasUserSupport,
        voteMissing,
      }
    }

    private printProposal(proposal: Proposal, threshold: bigint) {
      const { filename, proofSupport, onchainSupport, totalSupport, canPass, isPassed } = proposal;
      const voteMissing = Math.max(0, Number( threshold - totalSupport));
      let status = `Need ${voteMissing} votes to pass`;
      if(canPass){
        status = "Proposal can be passed.";
      } else if(isPassed){
        status = "Passed already passed.";
      }
      const resolutionIndex = proposal.proof.publicInput.govResolutionIndex.toBigint();
      const proposalHash = proposal.proof.publicOutput.proposalHash;

      console.log(`\nEngine Update proposal: ${filename}:`);
      console.log(`- Status: ${status}`);
      console.log(`- Resolution Index: ${resolutionIndex}`)
      console.log(`- Proposal Hash: ${proposalHash.toString()}`);
      console.log(`---------------------`);
      // print operations
      const operationString = prettyPrintOperation(proposal.proof.publicInput.protocolUpdateOperation);
      // add two whitespaces in front of each line to indent operationstring block
      operationString.split("\n").map((line) => `  ${line}`).join("\n");
      console.log(`- Operations:\n${operationString}`);
      console.log(`---------------------`);
      console.log(`- Proof Support: ${proposal.proofSupport}`);
      console.log(`- Onchain Support: ${proposal.onchainSupport}`);
      console.log(`- Total Support: ${proposal.totalSupport}`);
      console.log(`- Vote Missing: ${voteMissing}`);
    }
    
    private registerListCommand(parentCommand: Command) {
      parentCommand
        .command("list")
        .description("List all stored proposals")
        .action(async () => {
          throw new Error('Method not implemented.');
        });
    }

private registerCreateCommand(parentCommand: Command): void {
  parentCommand
    .command("create")
    .description("Interactively create a new engine update proposal")
    .action(async () => {
      const spinner = ora("Fetching current protocol state...").start();

      try {
        const account = await sessionManager.getAccountForCommand();
        if (!account) return;

        const chain = getCurrentChain() as blockchain;
        const client = await getClient(false);
        const current = client.getEngine().buildProtocolState();

        spinner.succeed("Fetched current protocol state");

        console.log(chalk.cyan("\nCurrent zkUSD Protocol State:"));
        console.log(`- emergencyStop:           ${current.emergencyStop.toBoolean()}`);
        console.log(`- collateralRatio:         ${current.collateralRatio.toBigInt()}`);
        console.log(`- validPriceBlockCount:    ${current.validPriceBlockCount.toBigInt()}`);
        console.log(`- liquidationBonusRatio:   ${current.liquidationBonusRatio.toBigInt()}`);
        console.log(`- oracleWhitelistHash:     ${current.oracleWhitelistHash.toString()}`);
        console.log(`- configMerkleRoot:        ${current.configMerkleRoot.toString()}`);
        console.log(`- vaultCreationDisabled:   ${current.vaultCreationDisabled.toBoolean()}`);
        console.log(`- vaultDebtCeiling:        ${current.vaultDebtCeiling.toBigInt()}\n`);

        const { selectedFields } = await inquirer.prompt([
          {
            type: "checkbox",
            name: "selectedFields",
            message: "Which fields would you like to update?",
            choices: [
              { name: "emergencyStop" },
              { name: "collateralRatio" },
              { name: "validPriceBlockCount" },
              { name: "liquidationBonusRatio" },
              { name: "oracleWhitelistHash" },
              { name: "configMerkleRoot" },
              { name: "vaultCreationDisabled" },
              { name: "vaultDebtCeiling" },
              new inquirer.Separator(),
              { name: "[ Proceed with selected changes ]" },
            ],
            validate: (choices) =>
              choices.length === 0
                ? "Select at least one field or proceed."
                : true,
          },
        ]);

        const values: Partial<EngineUpdateOperationFields> = {};

        for (const field of selectedFields) {
          if (field === "[ Proceed with selected changes ]") break;

          switch (field) {
            case "emergencyStop":
              const { emergencyStop } = await inquirer.prompt([
                {
                  type: "confirm",
                  name: "emergencyStop",
                  message: "Enable Emergency Stop?",
                  default: current.emergencyStop.toBoolean(),
                },
              ]);
              if(emergencyStop != current.emergencyStop.toBoolean()){
                values.emergencyStop = BoolOperation.set(emergencyStop);
              }
              break;

            case "collateralRatio":
              const { collateralRatio } = await inquirer.prompt([
                {
                  type: "number",
                  name: "collateralRatio",
                  message: "Collateral Ratio (%)",
                  default: current.collateralRatio.toBigInt(),
                },
              ]);
              if(collateralRatio != current.collateralRatio.toBigInt()){
                values.collateralRatio = UInt8Operation.set(collateralRatio);
              }
              break;

            case "validPriceBlockCount":
              const { validPriceBlockCount } = await inquirer.prompt([
                {
                  type: "number",
                  name: "validPriceBlockCount",
                  message: "Valid Price Block Count",
                  default: current.validPriceBlockCount.toBigInt(),
                },
              ]);
              if(validPriceBlockCount != current.validPriceBlockCount.toBigInt()){
                values.validPriceBlockCount = UInt8Operation.set(validPriceBlockCount);
              }
              break;

            case "liquidationBonusRatio":
              const { liquidationBonusRatio } = await inquirer.prompt([
                {
                  type: "number",
                  name: "liquidationBonusRatio",
                  message: "Liquidation Bonus Ratio (%)",
                  default: current.liquidationBonusRatio.toBigInt(),
                },
              ]);
              if(liquidationBonusRatio != current.liquidationBonusRatio.toBigInt()){
                values.liquidationBonusRatio = UInt8Operation.set(liquidationBonusRatio);
              }
              break;

            case "oracleWhitelistHash":
              const { oracleWhitelistHash } = await inquirer.prompt([
                {
                  type: "input",
                  name: "oracleWhitelistHash",
                  message: "Oracle Whitelist Hash",
                  default: current.oracleWhitelistHash.toString(),
                },
              ]);
              if(oracleWhitelistHash != current.oracleWhitelistHash.toString()){
                values.oracleWhitelistHash = FieldOperation.set(oracleWhitelistHash);
              }
              break;

            case "configMerkleRoot":
              const { configMerkleRoot } = await inquirer.prompt([
                {
                  type: "input",
                  name: "configMerkleRoot",
                  message: "Config Merkle Root",
                  default: current.configMerkleRoot.toString(),
                },
              ]);
              if(configMerkleRoot != current.configMerkleRoot.toString()){
                values.configMerkleRoot = FieldOperation.set(configMerkleRoot);
              }
              break;

            case "vaultCreationDisabled":
              const { vaultCreationDisabled } = await inquirer.prompt([
                {
                  type: "confirm",
                  name: "vaultCreationDisabled",
                  message: "Disable Vault Creation?",
                  default: current.vaultCreationDisabled.toBoolean(),
                },
              ]);
              if(vaultCreationDisabled != current.vaultCreationDisabled.toBoolean()){
                values.vaultCreationDisabled = BoolOperation.set(vaultCreationDisabled);
              }
              break;

            case "vaultDebtCeiling":
              const { vaultDebtCeiling } = await inquirer.prompt([
                {
                  type: "number",
                  name: "vaultDebtCeiling",
                  message: "Vault Debt Ceiling (zkUSD)",
                  default: current.vaultDebtCeiling.toBigInt(),
                },
              ]);
              if(vaultDebtCeiling != current.vaultDebtCeiling.toBigInt()){
                values.vaultDebtCeiling = UInt64Operation.set(vaultDebtCeiling);
              }
              break;
          }
        }

        const update = EngineUpdateOperation.create(values);
        const protocolPreconditions = ZkusdProtocolPreconditions.always();
        const blockchainPreconditions = defaultEngineUpdateChainPreconditions(chain);
        
        const govClient = await getGovClient();

        const spec = await govClient.engineUpdate.createSpec({
            operation: update,
            protocolPreconditions,
            blockchainPreconditions,
        });

        const proof = await govClient.engineUpdate.createVoteProof({
            updateSpec: spec,
            signature: Signature.create(account.keyPair.privateKey, spec.toFields()),
            seat: account.keyPair.publicKey,
        });

        console.log(chalk.green("\n✓ Proposal created. Hash: ", proof.publicOutput.proposalHash.toString()));

        await saveProof(proof);

      } catch (error: any) {
        spinner.fail(`Failed: ${error.message}`);
        process.exit(1);
      }
    });
}
}

async function saveProof(proof: EngineUpdateVoteProof) {
    // query for the name for the proof, make it filename friendly
    const defaultName = proof.publicOutput.proposalHash.toString();
    const { name } = await inquirer.prompt([
        {
            type: "input",
            name: "name",
            message: "Proposal name",
            default: defaultName,
        },
    ]);

    const proofStore = ProofStore.getInstance();
    proofStore.saveProof(proof, name);
}
