// DRAFT written by devx from CONTRACT.md §6 until the program agent commits the real IDL.
// Replace with `npm run sync-idl` (copies pof/program/target/idl/pof.json here). Do not edit by hand after that.
export const IDL_IS_DRAFT = true;
export const POF_IDL = {
  address: "sKhmjuNGqbdMaqDy4PQpWUyFroVkZMTjrXkTnrmdEwi",
  metadata: { name: "pof", version: "0.0.0-draft", spec: "0.1.0" },
  instructions: [
    {
      name: "require_certificate",
      discriminator: [133, 238, 16, 4, 145, 190, 131, 187],
      accounts: [{ name: "certificate" }],
      args: [
        { name: "subject_hash", type: { array: ["u8", 32] } },
        { name: "asset", type: "u8" },
        { name: "min_tier", type: "u8" },
      ],
    },
  ],
  accounts: [
    { name: "Certificate", discriminator: [202, 229, 222, 220, 116, 20, 74, 67] },
    { name: "Config", discriminator: [155, 12, 170, 224, 30, 250, 204, 130] },
  ],
  types: [
    {
      name: "Certificate",
      type: {
        kind: "struct",
        fields: [
          { name: "subject_kind", type: "u8" },
          { name: "subject_hash", type: { array: ["u8", 32] } },
          { name: "asset", type: "u8" },
          { name: "tier", type: "u8" },
          { name: "status", type: "u8" },
          { name: "certified_slot", type: "u64" },
          { name: "expiry_slot", type: "u64" },
          { name: "revoked_slot", type: "u64" },
          { name: "note_count", type: "u8" },
          { name: "nullifier_hashes", type: { array: [{ array: ["u8", 32] }, 8] } },
          { name: "payer", type: "pubkey" },
          { name: "log_index", type: "u64" },
          { name: "verifier", type: "pubkey" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "Config",
      type: {
        kind: "struct",
        fields: [
          { name: "admin", type: "pubkey" },
          { name: "verifier", type: "pubkey" },
          { name: "fee_lamports", type: "u64" },
          { name: "validity_slots", type: "u64" },
          { name: "root_mint", type: "pubkey" },
          { name: "certified", type: "u64" },
          { name: "revoked", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
} as const;
