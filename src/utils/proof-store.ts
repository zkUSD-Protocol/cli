import { deserializeProof, serializeProof } from "@zkusd/core";
import { EngineUpdateVoteProof, CouncilUpdateVoteProof } from "@zkusd/core";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

const ZKUSD_HOME_DIR = path.join(os.homedir(), ".zkusd");
const DEFAULT_PROOFS_DIR = path.join(ZKUSD_HOME_DIR, "proofs");

export class ProofStore {
    private proofsDir: string;

    // singleton instance
    private static instance: ProofStore;

    public static getInstance(): ProofStore {
        if (!ProofStore.instance) {
            ProofStore.instance = new ProofStore();
        }
        return ProofStore.instance;
    }

    private constructor(proofsDir: string = DEFAULT_PROOFS_DIR) {
        this.proofsDir = proofsDir;
        this.ensureProofsDirExists();
    }

    private ensureProofsDirExists() {
        if (!fs.existsSync(this.proofsDir)) {
            fs.mkdirSync(this.proofsDir, { recursive: true });
            console.log(chalk.yellow(`Created proofs directory at ${this.proofsDir}`));
        }
    }

    private async getProofs(): Promise<Map<string, EngineUpdateVoteProof | CouncilUpdateVoteProof>> {
        this.ensureProofsDirExists();
        const files = fs.readdirSync(this.proofsDir);
        const proofs: Map<string, EngineUpdateVoteProof | CouncilUpdateVoteProof> = new Map();
        for (const file of files) {
            const filePath = path.join(this.proofsDir, file);
            const jsonProof = fs.readFileSync(filePath, "utf8");
            let proof: EngineUpdateVoteProof | CouncilUpdateVoteProof;
            try {
                proof = await parseProof(JSON.parse(jsonProof));
            } catch (error) {
                console.error(chalk.red(`Failed to parse proof ${file}: ${error}`));
                continue;
            }
            proofs.set(this.sanitizeProofName(file), proof);
        }
        return proofs;
    }

    public async getEngineUpdateProposals(): Promise<Map<string, EngineUpdateVoteProof>> {
        const proofs = await this.getProofs();
        const engineProofs = new Map<string, EngineUpdateVoteProof>();
        for (const [name, proof] of proofs) {
            if (proof instanceof EngineUpdateVoteProof) {
                engineProofs.set(name, proof);
            }
        }
        return engineProofs;
    }

    public async getCouncilUpdateProposals(): Promise<Map<string, CouncilUpdateVoteProof>> {
        const proofs = await this.getProofs();
        const councilProofs = new Map<string, CouncilUpdateVoteProof>();
        for (const [name, proof] of proofs) {
            if (proof instanceof CouncilUpdateVoteProof) {
                councilProofs.set(name, proof);
            }
        }
        return councilProofs;
    }

    public saveProof(proof: EngineUpdateVoteProof, name: string) {
        try {
            this.ensureProofsDirExists();
            const jsonProof = serializeProof(proof);
            const filePath = path.join(this.proofsDir, `${this.sanitizeProofName(name)}.json`);
            fs.writeFileSync(filePath, JSON.stringify(jsonProof, null, 2));
            console.log(chalk.green(`Proof saved to ${filePath}`));
        } catch (error) {
            console.error(chalk.red(`Failed to save proof: ${error}`));
        }
    }

    public async loadProof(name: string): Promise<EngineUpdateVoteProof | null> {
        try {
            const filePath = path.join(this.proofsDir, `${this.sanitizeProofName(name)}.json`);
            const jsonProof = fs.readFileSync(filePath, "utf8");
            return await deserializeProof(JSON.parse(jsonProof), EngineUpdateVoteProof);
        } catch (error) {
            console.error(chalk.red(`Failed to load proof: ${error}`));
            return null;
        }
    }

    private sanitizeProofName(name: string): string {
        return name.replace(/[^a-zA-Z0-9]/g, "_");
    }
}

async function parseProof(proof: any): Promise<EngineUpdateVoteProof | CouncilUpdateVoteProof> {
    try {
        return deserializeProof(proof, EngineUpdateVoteProof);
    } catch {
        return deserializeProof(proof, CouncilUpdateVoteProof);
    }
}
