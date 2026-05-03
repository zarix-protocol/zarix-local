// Buffer polyfill for browser
const { Buffer } = require('buffer');
globalThis.Buffer = Buffer;

const solanaWeb3 = require('@solana/web3.js');
const splToken = require('@solana/spl-token');

module.exports = {
  Connection: solanaWeb3.Connection,
  PublicKey: solanaWeb3.PublicKey,
  Transaction: solanaWeb3.Transaction,
  TransactionInstruction: solanaWeb3.TransactionInstruction,
  SystemProgram: solanaWeb3.SystemProgram,
  SYSVAR_RENT_PUBKEY: solanaWeb3.SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY: solanaWeb3.SYSVAR_CLOCK_PUBKEY,
  LAMPORTS_PER_SOL: solanaWeb3.LAMPORTS_PER_SOL,
  TOKEN_PROGRAM_ID: splToken.TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync: splToken.getAssociatedTokenAddressSync,
  getAssociatedTokenAddress: splToken.getAssociatedTokenAddress,
  getAccount: splToken.getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction: splToken.createAssociatedTokenAccountInstruction,
};
