// The one decision both bots make: does this linked subject pass this Room right now?
import { sdk } from "../api/v1/_lib.js";
import { subjectQuery } from "./link.js";

export async function loadRoom(client, room) {
  if (!sdk.isAddress(String(room))) return null;
  return client.getRoom(room);
}

/**
 * @returns {{ ok: boolean, reason: string, text: string, certificate: object|null, room: object }}
 */
export async function evaluate(client, roomInfo, linkRec) {
  const need = roomInfo.minTierLabel;
  if (!linkRec) return { ok: false, reason: "not_linked", text: `Link a subject with a live certificate ${need} to enter.`, certificate: null, room: roomInfo };
  const r = await client.checkProofOfFunds({ subject: subjectQuery(linkRec), asset: roomInfo.asset, minTier: roomInfo.minTier });
  const c = r.certificate;
  const text = {
    ok: `Certificate ${c?.tierLabel} is live: it meets ${need}.`,
    no_certificate: `No ${roomInfo.assetSymbol} certificate for the linked subject. This room needs ${need}.`,
    below_tier: `The certificate reads ${c?.tierLabel}; this room needs ${need}.`,
    revoked_spent: `The certificate was revoked at slot ${c?.revokedSlot}: the certified funds moved. Certify again to enter.`,
    revoked_by_holder: `The certificate was revoked by its holder at slot ${c?.revokedSlot}.`,
    expired: `The certificate expired at slot ${c?.expirySlot}. Renew it to enter.`,
  }[r.reason];
  return { ok: r.ok, reason: r.reason, text, certificate: c, room: roomInfo, slot: r.slot };
}
