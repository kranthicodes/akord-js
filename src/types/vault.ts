import { Encryptable, encrypted, EncryptedKeys } from "@akord/crypto";
import { Membership } from "./membership";
import { Folder, Memo, Stack } from "./node";

export class Vault extends Encryptable {
  id: string;
  status: string;
  public: boolean;
  createdAt: string;
  updatedAt: string;
  data: Array<string>;
  size?: number;
  @encrypted() name: string;

  memberships?: Array<Membership>;
  memos?: Array<Memo>;
  stacks?: Array<Stack>;
  folders?: Array<Folder>;

  constructor(vaultProto: any, keys: Array<EncryptedKeys>) {
    super(keys, null);
    this.id = vaultProto.id;
    this.public = vaultProto.public;
    this.createdAt = vaultProto.createdAt;
    this.updatedAt = vaultProto.updatedAt;
    this.size = vaultProto.size;
    this.name = vaultProto.name;
    this.status = vaultProto.status;
    this.data = vaultProto.data;
    this.keys = keys;
    this.memberships = vaultProto?.memberships?.map((membership: Membership) => new Membership(membership, keys));
    this.memos = vaultProto?.memos?.map((memo: Memo) => new Memo(memo, keys));
    this.stacks = vaultProto?.stacks?.map((stack: Stack) => new Stack(stack, keys));
    this.folders = vaultProto?.folders?.map((folder: Folder) => new Folder(folder, keys));
  }
}
