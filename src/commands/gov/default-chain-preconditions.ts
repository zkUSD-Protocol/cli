import { blockchain } from "@zkusd/core";
import { MinaChainPreconditions } from "@zkusd/core/build/src/system/engine-update/blockchain-preconditions";

// TODO: extend later for devnet, mainnet
export function defaultEngineUpdateChainPreconditions(chain: blockchain) {
    return MinaChainPreconditions.always();
}