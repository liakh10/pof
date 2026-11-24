
export const PofGateErrorCode = {
  NotCreator: 6000,
  RoomShut: 6001,
  BadTier: 6002,
  NotController: 6003,
  StillValid: 6004,
  MembersLeft: 6005,
  BadPofConfig: 6006,
  NotClosing: 6007,
  BadCertificate: 6008
};

export type PofGateErrorName = keyof typeof PofGateErrorCode;
