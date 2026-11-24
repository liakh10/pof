// DRAFT written by devx from CONTRACT.md §6 until the program agent commits the real IDL.
// Replace with `npm run sync-idl` (copies pof/program/target/idl/pof_gate.json here).
export const IDL_IS_DRAFT = true;
export const POF_GATE_IDL = {
  address: "42iRXsi4PdFG2BwraUKtcxmWthF8df67zp7r9s3GhLxv",
  metadata: { name: "pof_gate", version: "0.0.0-draft", spec: "0.1.0" },
  instructions: [
    {
      name: "join",
      discriminator: [206, 55, 2, 106, 113, 220, 17, 163],
      accounts: [
        { name: "room", writable: true },
        { name: "member", writable: true },
        { name: "certificate" },
        { name: "payer", writable: true, signer: true },
        { name: "pof_program", address: "sKhmjuNGqbdMaqDy4PQpWUyFroVkZMTjrXkTnrmdEwi" },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [{ name: "subject_hash", type: { array: ["u8", 32] } }],
    },
  ],
  accounts: [
    { name: "Room", discriminator: [156, 199, 67, 27, 222, 23, 185, 94] },
    { name: "Member", discriminator: [54, 19, 162, 21, 29, 166, 17, 198] },
  ],
  types: [
    {
      name: "Room",
      type: {
        kind: "struct",
        fields: [
          { name: "creator", type: "pubkey" },
          { name: "id", type: "u64" },
          { name: "asset", type: "u8" },
          { name: "min_tier", type: "u8" },
          { name: "member_count", type: "u32" },
          { name: "created_slot", type: "u64" },
          { name: "bump", type: "u8" },
          { name: "name", type: "string" },
        ],
      },
    },
    {
      name: "Member",
      type: {
        kind: "struct",
        fields: [
          { name: "room", type: "pubkey" },
          { name: "subject_hash", type: { array: ["u8", 32] } },
          { name: "certificate", type: "pubkey" },
          { name: "joined_slot", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
} as const;
