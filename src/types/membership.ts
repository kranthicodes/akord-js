import { Encryptable, EncryptedKeys } from "@akord/crypto";
import { ProfileDetails } from "./profile-details";

export type RoleType = "VIEWER" | "CONTRIBUTOR" | "OWNER";
export type StatusType = "ACCEPTED" | "PENDING" | "REVOKED" | "INVITED";

export class Membership extends Encryptable {
  id: string;
  owner: string;
  createdAt: string; // number
  updatedAt: string; // number
  expiresAt: string;
  status: StatusType;
  address: string;
  role: RoleType;
  data?: string[];
  encPublicSigningKey: string;
  email: string;
  memberPublicSigningKey: string;
  memberDetails: ProfileDetails;

  vaultId: string;
  keys: EncryptedKeys[];

  // vault context
  __public__?: boolean;
  __cacheOnly__?: boolean;

  constructor(membershipProto: any, keys?: Array<EncryptedKeys>) {
    super(keys, null)
    this.id = membershipProto.id;
    this.owner = membershipProto.owner;
    this.address = membershipProto.address;
    this.createdAt = membershipProto.createdAt;
    this.updatedAt = membershipProto.updatedAt;
    this.expiresAt = membershipProto.expiresAt;
    this.data = membershipProto.data;
    this.status = membershipProto.status;
    this.role = membershipProto.role;
    this.encPublicSigningKey = membershipProto.encPublicSigningKey;
    this.email = membershipProto.email;
    this.memberPublicSigningKey = membershipProto.memberPublicSigningKey;
    this.vaultId = membershipProto.vaultId;
    this.keys = membershipProto.keys;
    this.memberDetails = new ProfileDetails(membershipProto.memberDetails, keys);
    this.__public__ = membershipProto.__public__;
    this.__cacheOnly__ = membershipProto.__cacheOnly__;
  }
}

export type MembershipKeys = {
  isEncrypted: boolean;
  keys: EncryptedKeys[];
  publicKey?: string;
};