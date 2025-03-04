import { Akord } from "../index";
import faker from '@faker-js/faker';
import { initInstance, testDataPath, vaultCreate } from './common';
import { email, password } from './data/test-credentials';
import { StorageType } from "../types/node";
import { getTxData } from "../arweave";
import { firstFileName, secondFileName, arweaveImportFileTx } from './data/content';
import { createFileLike } from "../core/file";
import fs from "fs";

let akord: Akord;

jest.setTimeout(3000000);

describe("Testing stack functions", () => {
  let vaultId: string;
  let stackId: string;

  beforeEach(async () => {
    akord = await initInstance(email, password);
  });

  beforeAll(async () => {
    akord = await initInstance(email, password);
    vaultId = (await vaultCreate(akord)).vaultId;
  });

  it("should create stack from path", async () => {
    const name = faker.random.words();

    stackId = (await akord.stack.create(vaultId, testDataPath + firstFileName, name)).stackId;

    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("ACTIVE");
    expect(stack.name).toEqual(name);
    expect(stack.versions.length).toEqual(1);
    expect(stack.versions[0].name).toEqual(firstFileName);

    const binary = await akord.file.get(stack.getUri(StorageType.S3, 0), vaultId);
    const file = await createFileLike(testDataPath + firstFileName);
    expect(stack.versions[0].type).toEqual(file.type);
    expect(binary).toEqual(await file.arrayBuffer());
  });

  it("should upload new revision", async () => {
    await akord.stack.uploadRevision(stackId, testDataPath + secondFileName);

    const stack = await akord.stack.get(stackId);
    expect(stack.versions.length).toEqual(2);
    expect(stack.versions[0].name).toEqual(firstFileName);
    expect(stack.versions[1].name).toEqual(secondFileName);

    const { data } = await akord.stack.getVersion(stackId);
    const file = await createFileLike(testDataPath + secondFileName);
    expect(stack.versions[1].type).toEqual(file.type);
    expect(data).toEqual(await file.arrayBuffer());

    const firstFile = await createFileLike(testDataPath + firstFileName);
    const { data: firstFileData } = await akord.stack.getVersion(stackId, 0);
    expect(firstFileData).toEqual(await firstFile.arrayBuffer());
  });

  it("should rename the stack", async () => {
    const name = faker.random.words();

    await akord.stack.rename(stackId, name);

    const stack = await akord.stack.get(stackId);
    expect(stack.name).toEqual(name);
    expect(stack.versions.length).toEqual(2);
    expect(stack.versions[0].name).toEqual(firstFileName);
    expect(stack.versions[1].name).toEqual(secondFileName);

    const firstFile = await createFileLike(testDataPath + firstFileName);
    const { data: firstFileData } = await akord.stack.getVersion(stackId, 0);
    expect(firstFileData).toEqual(await firstFile.arrayBuffer());

    const secondFile = await createFileLike(testDataPath + secondFileName);

    const { data: secondFileData } = await akord.stack.getVersion(stackId);
    expect(secondFileData).toEqual(await secondFile.arrayBuffer());
  });

  it("should revoke the stack", async () => {
    await akord.stack.revoke(stackId)
    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("REVOKED");
  });

  it("should restore the stack", async () => {
    await akord.stack.restore(stackId)
    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("ACTIVE");
  });

  it("should import new stack from arweave tx", async () => {
    const fileName = arweaveImportFileTx + ".jpeg";
    const { stackId } = await akord.stack.import(vaultId, arweaveImportFileTx);

    const stack = await akord.stack.get(stackId);
    expect(stack.name).toEqual(fileName);
    expect(stack.versions.length).toEqual(1);
    expect(stack.versions[0].name).toEqual(fileName);

    const { data } = await akord.stack.getVersion(stackId);
    expect(data).toEqual(await getTxData(arweaveImportFileTx));
  });

  it("should create stack from file buffer", async () => {
    const name = faker.random.words();

    const fileBuffer = fs.readFileSync(testDataPath + firstFileName);
    const type = "image/png";

    const { stackId } = await akord.stack.create(vaultId, fileBuffer, name, { name: firstFileName, mimeType: type });

    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("ACTIVE");
    expect(stack.name).toEqual(name);
    expect(stack.versions.length).toEqual(1);
    expect(stack.versions[0].name).toEqual(firstFileName);
    expect(stack.versions[0].type).toEqual(type);

    const binary = await akord.file.get(stack.getUri(StorageType.S3, 0), vaultId);
    const file = await createFileLike(testDataPath + firstFileName);
    expect(binary).toEqual(await file.arrayBuffer());
    return stackId;
  });

  it("should create stack from file stream", async () => {
    const name = faker.random.words();

    const fileStream = fs.createReadStream(testDataPath + firstFileName);
    const type = "image/png";

    const { stackId } = await akord.stack.create(vaultId, fileStream, name, { name: firstFileName, mimeType: type });

    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("ACTIVE");
    expect(stack.name).toEqual(name);
    expect(stack.versions.length).toEqual(1);
    expect(stack.versions[0].name).toEqual(firstFileName);
    expect(stack.versions[0].type).toEqual(type);

    const binary = await akord.file.get(stack.getUri(StorageType.S3, 0), vaultId);
    const file = await createFileLike(testDataPath + firstFileName);
    expect(binary).toEqual(await file.arrayBuffer());
    return stackId;
  });


  it("should create stack from file object", async () => {
    const name = faker.random.words();

    const file = await createFileLike(testDataPath + firstFileName);

    const { stackId } = await akord.stack.create(vaultId, file, name);

    const stack = await akord.stack.get(stackId);
    expect(stack.status).toEqual("ACTIVE");
    expect(stack.name).toEqual(name);
    expect(stack.versions.length).toEqual(1);
    expect(stack.versions[0].name).toEqual(firstFileName);
    expect(stack.versions[0].type).toEqual(file.type);

    const binary = await akord.file.get(stack.getUri(StorageType.S3, 0), vaultId);
    expect(binary).toEqual(await file.arrayBuffer());
    return stackId;
  });
});
