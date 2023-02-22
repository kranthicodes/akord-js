import { Akord, Auth } from "../index";
import { email, password } from './data/test-credentials';
import { vaults, fileId, message, publicVaultId, privateVaultId } from './data/content';
import { NodeJs } from "../types/file";

let clientWithAkordApi: Akord;
let clientWithArweaveApi: Akord;
let clientWithoutWallet: Akord;

jest.setTimeout(3000000);

describe("Testing querying directly from permaweb", () => {
  beforeAll(async () => {
    const { jwtToken, wallet } = await Auth.signIn(email, password);
    clientWithAkordApi = new Akord(wallet, jwtToken, { wallet: <any>"Akord" });
    clientWithArweaveApi = new Akord(wallet, undefined, { wallet: <any>"Arweave" });
    clientWithoutWallet = new Akord(undefined, undefined, { wallet: <any>"Akord" });

  });

  it("Query all vaults from Akord API", async () => {
    const result = await clientWithAkordApi.vault.list();
    expect(result).toEqual(vaults);
  });

  it("Should query public vault - contract state from Akord API", async () => {
    const result = await clientWithoutWallet.contract.getState(publicVaultId);
    expect(result.name).not.toBeNull();
    expect(result.public).toBeTruthy();
    expect(result.folders.length).toBeTruthy();
    expect(result.stacks.length).toBeTruthy();
    expect(result.notes.length).toBeTruthy();
  });

  it("Should query private vault - contract state from Arweave API & decrypt with Akord Wallet", async () => {
    const result = await clientWithArweaveApi.contract.getState(privateVaultId);
    expect(result.name).not.toBeNull();
    expect(result.folders.length).toBeTruthy();
    expect(result.folders[0].name).toBeTruthy();
    expect(result.stacks.length).toBeTruthy();
    expect(result.memberships.length).toBeTruthy();
  });

  it("Query all vaults from Arweave API", async () => {
    const result = await clientWithArweaveApi.vault.list();
    expect(result).toEqual(vaults);
  });

  it("Query memos from Arweave API", async () => {
    const result = await clientWithArweaveApi.memo.list(vaults[0].id);
    expect(result.length).toEqual(1);
    expect(result[0].message).toEqual(message);
  });

  it("Query chunked file from Akord API", async () => {
    const decryptedFile = await clientWithAkordApi.file.get(fileId, vaults[0].id, { isChunked: true, numberOfChunks: 3 });
    const file = NodeJs.File.fromPath("./src/__tests__/data/chunked-file.test");
    expect(Buffer.from(decryptedFile)).toEqual(await file.arrayBuffer());
  });

  it("Query chunked file from Akord API", async () => {
    const decryptedFile = await clientWithAkordApi.file.get(fileId, vaults[0].id, { isChunked: true, numberOfChunks: 3 });
    const file = NodeJs.File.fromPath("./src/__tests__/data/chunked-file.test");
    expect(Buffer.from(decryptedFile)).toEqual(await file.arrayBuffer());
  });
});
