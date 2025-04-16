import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  MinaPriceInput,
  OracleWhitelist,
  getOracles,
  getActiveOracles,
  oracleAggregationVk,
  blockchain,
  KeyPair,
  Oracle,
  getNetworkKeys,
} from "@zkusd/core";
import {
  UInt32,
  UInt64,
  Field,
  Signature,
  fetchLastBlock,
  PublicKey,
  Bool,
} from "o1js";
import { getCurrentChain } from "./network.js";
import Client from "mina-signer";
import chalk from "chalk";
import ora from "ora";
import { getLightnetPrice } from "./lightnet.js";

const devnetClient = new Client({
  network: "testnet",
});

const mainnetClient = new Client({
  network: "mainnet",
});

//Compile the proof circuit
async function compileProofCircuit() {
  try {
    await AggregateOraclePrices.compile();
  } catch (error) {
    console.log("failed to compile proof circuit");
    throw new Error("Failed to compile proof circuit");
  }
}

/**
 * Gets a fresh price proof for the currently selected network.
 * This fetches actual oracle submissions from oracle endpoints
 * and generates a proof for the current block height.
 *
 * @returns A MinaPriceInput object containing the proof
 */
export async function getPriceProof(): Promise<MinaPriceInput> {
  const spinner = ora("Preparing price proof...").start();

  try {
    spinner.text = "Compiling proof circuit...";

    await compileProofCircuit();

    // Get the current chain
    const chain = getCurrentChain();
    if (!chain) {
      spinner.fail("No chain configured");
      throw new Error(
        'No chain has been configured. Use "zkusd network use <chain>" to set a chain.'
      );
    }

    // Get current block height
    spinner.text = "Fetching current block height...";
    const currentBlock = await fetchLastBlock();
    const currentBlockHeight = currentBlock.blockchainLength;

    spinner.text = "Collecting oracle price submissions...";

    let submissions: OraclePriceSubmissions;
    let whitelist: OracleWhitelist;
    let oracleCount: number;

    if (chain === "lightnet") {
      ({ submissions, whitelist, oracleCount } =
        await getLightnetOracleSubmissions(currentBlockHeight));
    } else {
      ({ submissions, whitelist, oracleCount } = await getOracleSubmissions(
        chain as blockchain,
        currentBlockHeight
      ));
    }

    if (!submissions || !whitelist || !oracleCount) {
      spinner.fail("Failed to collect oracle price submissions");
      throw new Error("Failed to collect oracle price submissions");
    }

    // Generate the proof
    spinner.text = "Computing oracle price proof...";
    const oracleWhitelistHash = OracleWhitelist.hash(whitelist);

    const programOutput = await AggregateOraclePrices.compute(
      {
        currentBlockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: whitelist,
        oraclePriceSubmissions: submissions,
      }
    );

    // Create the MinaPriceInput
    const priceInput = new MinaPriceInput({
      proof: programOutput.proof,
      verificationKey: oracleAggregationVk,
    });

    spinner.succeed(
      `Price proof generated for block ${currentBlockHeight.toString()} with ${oracleCount} oracle submissions`
    );

    return priceInput;
  } catch (error: any) {
    spinner.fail(`Failed to generate price proof: ${error.message}`);
    throw new Error(`Price proof generation failed: ${error.message}`);
  }
}

function isRealOracle(oracle: KeyPair | Oracle): oracle is Oracle {
  return "endpoint" in oracle && "publicKey" in oracle;
}

/**
 * @notice Get oracle submissions for lightnet
 * @param blockHeight The block height to get submissions for
 * @return Promise resolving to an object containing the submissions, whitelist, and oracle count
 */
async function getLightnetOracleSubmissions(blockHeight: UInt32): Promise<{
  submissions: OraclePriceSubmissions;
  whitelist: OracleWhitelist;
  oracleCount: number;
}> {
  // Get the price (already in nanoUSD format)
  const nanoPrice = getLightnetPrice();

  // For display purposes, show the human-readable price
  const displayPrice = nanoPrice / 1e9;
  console.log(
    chalk.yellow(
      `\nUsing configured price of $${displayPrice.toFixed(2)} USD for lightnet`
    )
  );

  const oracles: Array<KeyPair> = [];

  const networkKeys = getNetworkKeys("lightnet");
  networkKeys.oracles!.map((oracle) => {
    oracles.push({
      publicKey: oracle.publicKey,
      privateKey: oracle.privateKey,
    } as KeyPair);
  });

  const whitelist = new OracleWhitelist({
    addresses: oracles.map((oracle) => oracle.publicKey),
  });

  const submissions: PriceSubmission[] = await Promise.all(
    Array.from({ length: OracleWhitelist.MAX_PARTICIPANTS }).map(
      async (_, index) => {
        let signature: Signature;
        let dummyPrice: UInt64;
        let isDummy: Bool;
        let publicKey: PublicKey;

        const client =
          getCurrentChain() === "mainnet" ? mainnetClient : devnetClient;

        dummyPrice = UInt64.from(nanoPrice);
        const signed = client.signFields(
          [dummyPrice.toBigInt(), blockHeight.toBigint()],
          oracles[index].privateKey.toBase58()
        );
        signature = Signature.fromBase58(signed.signature);
        isDummy = Bool(false);
        publicKey = oracles[index].publicKey;

        return new PriceSubmission({
          price: UInt64.from(nanoPrice),
          signature,
          isDummy,
          publicKey,
          blockHeight,
        });
      }
    )
  );

  return {
    submissions: new OraclePriceSubmissions({ submissions }),
    whitelist,
    oracleCount: oracles.length,
  };
}

/**
 * @notice Get oracle submissions for a given chain and block height
 * @param chain The blockchain to get submissions for
 * @param blockHeight The block height to get submissions for
 * @return Promise resolving to an object containing the submissions, whitelist, and oracle count
 */
async function getOracleSubmissions(
  chain: blockchain,
  blockHeight: UInt32
): Promise<{
  submissions: OraclePriceSubmissions;
  whitelist: OracleWhitelist;
  oracleCount: number;
}> {
  // Get the oracle configuration for this chain
  const oracleConfig = getOracles(chain);

  let oracleCount = 0;

  const whitelist = oracleConfig.oracleWhitelist;

  const submissions: PriceSubmission[] = await Promise.all(
    Array.from({ length: OracleWhitelist.MAX_PARTICIPANTS }).map(
      async (_, index) => {
        let signature: Signature;
        let price: UInt64;
        let isDummy: Bool;
        let publicKey: PublicKey;

        const client =
          getCurrentChain() === "mainnet" ? mainnetClient : devnetClient;

        function createDummySubmission(): PriceSubmission {
          price = UInt64.MAXINT();
          const dummySigned = client.signFields(
            [price.toBigInt(), blockHeight.toBigint()],
            oracleConfig.dummyOracleKey.toBase58()
          );
          signature = Signature.fromBase58(dummySigned.signature);
          isDummy = Bool(true);
          publicKey = oracleConfig.dummyOracleKey.toPublicKey();

          return new PriceSubmission({
            price,
            signature,
            isDummy,
            publicKey,
            blockHeight,
          });
        }

        if (isRealOracle(oracleConfig.oracles[index])) {
          try {
            // Add timeout to fetch requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch(
              oracleConfig.oracles[index].endpoint!,
              {
                signal: controller.signal,
              }
            ).catch((error) => {
              throw new Error(`Connection to oracle ${index} failed`);
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(
                `Oracle ${index} returned non-200 status: ${response.status}`
              );
            }

            const oracleResponse = await response.json().catch((error) => {
              throw new Error(
                `Oracle ${index} returned invalid JSON: ${error.message}`
              );
            });

            if (oracleResponse.error) {
              throw new Error(
                `Oracle ${index} returned error: ${oracleResponse.error}`
              );
            }

            if (
              !oracleResponse.signed ||
              !oracleResponse.signed.signature ||
              !oracleResponse.signed.data ||
              !oracleResponse.signed.data.price ||
              !oracleResponse.signed.data.blockHeight
            ) {
              throw new Error(`Oracle ${index} returned incomplete data`);
            }

            price = UInt64.from(oracleResponse.signed.data.price);
            signature = Signature.fromBase58(oracleResponse.signed.signature);
            isDummy = Bool(false);
            publicKey = oracleConfig.oracles[index].publicKey;

            // Verify the signature
            const validSig: Bool = signature.verify(publicKey, [
              price.toFields()[0],
              blockHeight.toFields()[0],
            ]);

            if (!validSig) {
              throw new Error(`Oracle ${index} signature verification failed`);
            }
          } catch (error: any) {
            // On any error with this oracle, fall back to a dummy submission
            //TODO: Handle this better
            console.log(
              `Oracle ${index} fetch failed, using dummy submission: ${error.message}`
            );

            return createDummySubmission();
          }
        } else {
          // return a dummy submission
          return createDummySubmission();
        }

        oracleCount++;

        return new PriceSubmission({
          price,
          signature,
          isDummy,
          publicKey,
          blockHeight,
        });
      }
    )
  );

  return {
    submissions: new OraclePriceSubmissions({ submissions }),
    whitelist,
    oracleCount,
  };
}
