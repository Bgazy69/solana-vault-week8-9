/**
 * Close a Raydium CLMM position through our Vault program.
 *
 * Position data is loaded from scripts/last-position.json.
 * Run only after a position has been successfully opened.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { SimpleVault } from "../target/types/simple_vault";
import { Raydium, DEV_API_URLS } from "@raydium-io/raydium-sdk-v2";

// SPL Memo Program
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const MY_TOKEN_MINT = new PublicKey(
  "UtVqq5DZpoGX9USfdR6gFLvTKN5mCbssGH2VRfVDY97"
);

const TOKEN_B_MINT = new PublicKey(
  "ptNKTKbfbqVY5JMVThP5BKN4piH5Q6UF1TqBAdbCsSe"
);

const RAYDIUM_CLMM_DEVNET = new PublicKey(
  "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
);

function loadWallet(): Keypair {
  const keyPath = path.join(process.env.HOME!, ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadPositionData() {
  const filePath = path.join(__dirname, "last-position.json");

  if (!fs.existsSync(filePath)) {
    throw new Error("last-position.json табылмады. Алдымен позиция ашылуы керек.");
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

console.log("Collect Fees скриптінің бастапқы бөлігі дайын.");

// ─── Vault және позиция аккаунттарын дайындау ─────────────────────────────

async function main() {
  const wallet = loadWallet();
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../target/idl/simple_vault.json"),
      "utf-8"
    )
  );

  const program = new Program<SimpleVault>(idl, provider);
  const position = loadPositionData();

  if (position.cluster !== "devnet") {
    throw new Error("Бұл скрипт тек Devnet позициясына арналған.");
  }

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), MY_TOKEN_MINT.toBuffer()],
    program.programId
  );

  const [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tokens"), MY_TOKEN_MINT.toBuffer()],
    program.programId
  );

  const vaultTokenBAccount = await getAssociatedTokenAddress(
    TOKEN_B_MINT,
    vaultStatePDA,
    true
  );

  const positionNftMint = new PublicKey(position.positionNftMint);
  const positionNftAccount = new PublicKey(position.positionNftAccount);
  const personalPosition = new PublicKey(position.personalPosition);

  const poolId = new PublicKey(position.poolId);

  const raydium = await Raydium.load({
    connection,
    owner: wallet.publicKey,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    urlConfigs: {
      BASE_HOST: DEV_API_URLS.BASE_HOST,
    },
  });

  const poolData = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const poolKeys = poolData.poolKeys;

  const tokenVault0 = new PublicKey(poolKeys.vault.A);
  const tokenVault1 = new PublicKey(poolKeys.vault.B);
  const vault0Mint = new PublicKey(poolKeys.mintA.address);
  const vault1Mint = new PublicKey(poolKeys.mintB.address);

  console.log("Raydium Pool:", poolId.toBase58());
  console.log("Token Vault 0:", tokenVault0.toBase58());
  console.log("Token Vault 1:", tokenVault1.toBase58());

  // Raydium позициясының сақталған PDA аккаунттары
  const protocolPosition = new PublicKey(position.protocolPosition);
  const tickArrayLower = new PublicKey(position.tickArrayLower);
  const tickArrayUpper = new PublicKey(position.tickArrayUpper);

  console.log("Protocol Position:", protocolPosition.toBase58());
  console.log("Tick Array Lower:", tickArrayLower.toBase58());
  console.log("Tick Array Upper:", tickArrayUpper.toBase58());

  // Raydium Tick Array Bitmap Extension PDA
  const [tickArrayBitmap] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool_tick_array_bitmap_extension"),
      poolId.toBuffer(),
    ],
    RAYDIUM_CLMM_DEVNET
  );

  console.log("Tick Array Bitmap:", tickArrayBitmap.toBase58());

  console.log("Vault:", vaultStatePDA.toBase58());
  console.log("Position NFT:", positionNftMint.toBase58());
  console.log("Personal Position:", personalPosition.toBase58());

  // Collect Fees инструкциясын дайындау
  // amount0Min және amount1Min әзірге 0 (тек Devnet тесті үшін)
  const collectInstruction = await program.methods
    .collectRaydiumFees(new BN(0), new BN(0))
    .accountsPartial({
      admin: wallet.publicKey,
      vaultState: vaultStatePDA,
      vaultTokenAccount: vaultTokenAccountPDA,
      vaultWsolAccount: vaultTokenBAccount,
      wsolMint: TOKEN_B_MINT,
      poolState: poolId,
      positionNftMint,
      positionNftAccount,
      personalPosition,
      protocolPosition,
      tokenVault0,
      tokenVault1,
      tickArrayLower,
      tickArrayUpper,
      vault0Mint,
      vault1Mint,
      clmmProgram: RAYDIUM_CLMM_DEVNET,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      {
        pubkey: tickArrayBitmap,
        isSigner: false,
        isWritable: true,
      },
    ])
    .instruction();

  console.log("Collect Fees инструкциясы дайын!");
  console.log("Instruction accounts:", collectInstruction.keys.length);

  const tx = new anchor.web3.Transaction().add(collectInstruction);
  const simulation = await provider.simulate(tx);

  console.log("Collect Fees simulation logs:");
  console.log(simulation.logs?.join("\n"));
  console.log("Simulation completed successfully.");

  console.log("✅ Collect Fees simulation successful!");

  const signature = await provider.sendAndConfirm(tx, [], {
    commitment: "confirmed",
  });

  console.log("✅ Collect Fees transaction confirmed!");
  console.log("TX:", signature);
  console.log(
    "Explorer: https://explorer.solana.com/tx/" +
      signature +
      "?cluster=devnet"
  );

}

main().catch((err) => {
  console.error("\n❌ Collect Fees қатесі:", err);

  if (err.logs) {
    console.error("\nProgram logs:");
    err.logs.forEach((log: string) => console.error(" ", log));
  }

  process.exit(1);
});
