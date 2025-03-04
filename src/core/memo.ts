import { NodeCreateOptions, NodeService } from "./node";
import { reactionEmoji, actionRefs, functions } from "../constants";
import lodash from "lodash";
import { Memo, MemoReaction, MemoVersion, nodeType } from "../types/node";
import { ListOptions } from "../types/query-options";
import { NotFound } from "../errors/not-found";
import { EncryptedKeys } from "@akord/crypto";
import { IncorrectEncryptionKey } from "../errors/incorrect-encryption-key";

class MemoService extends NodeService<Memo> {
  static readonly reactionEmoji = reactionEmoji;

  objectType = nodeType.MEMO;
  NodeType = Memo;

  defaultListOptions = {
    shouldDecrypt: true,
    filter: {}
  } as ListOptions;

  /**
   * @param  {string} vaultId
   * @param  {string} message
   * @param  {NodeCreateOptions} [options] parent id, etc.
   * @returns Promise with new node id & corresponding transaction id
   */
  public async create(vaultId: string, message: string, options: NodeCreateOptions = this.defaultCreateOptions): Promise<MemoCreateResult> {
    const service = new MemoService(this.wallet, this.api);
    await service.setVaultContext(vaultId);
    service.setActionRef(actionRefs.MEMO_CREATE);
    service.setFunction(functions.NODE_CREATE);
    service.setAkordTags(options.tags);
    const state = {
      versions: [await service.memoVersion(message)],
      tags: options.tags || []
    };
    const { nodeId, transactionId, object } = await service.nodeCreate<Memo>(state, { parentId: options.parentId }, options.arweaveTags);
    return { memoId: nodeId, transactionId, object };
  }

  /**
   * @param  {string} memoId
   * @param  {reactionEmoji} reaction
   * @returns Promise with corresponding transaction id
   */
  public async addReaction(memoId: string, reaction: reactionEmoji): Promise<MemoUpdateResult> {
    const service = new MemoService(this.wallet, this.api);
    await service.setVaultContextFromNodeId(memoId, this.objectType);
    service.setActionRef(actionRefs.MEMO_ADD_REACTION);
    service.setFunction(functions.NODE_UPDATE);
    service.arweaveTags = await service.getTxTags();

    const currentState = await service.getCurrentState();
    const newState = lodash.cloneDeepWith(currentState);
    newState.versions[newState.versions.length - 1].reactions.push(await service.memoReaction(reaction));
    const dataTxId = await service.uploadState(newState);

    const { id, object } = await this.api.postContractTransaction<Memo>(
      service.vaultId,
      { function: service.function, data: dataTxId },
      service.arweaveTags
    );
    const memo = await this.processMemo(object, !service.isPublic, service.keys);
    return { transactionId: id, object: memo };
  }

  /**
   * @param  {string} memoId
   * @param  {reactionEmoji} reaction
   * @returns Promise with corresponding transaction id
   */
  public async removeReaction(memoId: string, reaction: reactionEmoji): Promise<MemoUpdateResult> {
    const service = new MemoService(this.wallet, this.api);
    await service.setVaultContextFromNodeId(memoId, this.objectType);
    service.setActionRef(actionRefs.MEMO_REMOVE_REACTION);
    service.setFunction(functions.NODE_UPDATE);
    service.arweaveTags = await service.getTxTags();

    const state = await service.deleteReaction(reaction);
    const dataTxId = await service.uploadState(state);

    const { id, object } = await this.api.postContractTransaction<Memo>(
      service.vaultId,
      { function: service.function, data: dataTxId },
      service.arweaveTags
    );
    const memo = await this.processMemo(object, !service.isPublic, service.keys);
    return { transactionId: id, object: memo };
  }

  protected async processMemo(object: Memo, shouldDecrypt: boolean, keys?: EncryptedKeys[]): Promise<Memo> {
    const memo = new Memo(object, keys);
    if (shouldDecrypt) {
      try {
        await memo.decrypt();
      } catch (error) {
        throw new IncorrectEncryptionKey(error);
      }
    }
    return memo;
  }

  private async memoVersion(message: string): Promise<MemoVersion> {
    const version = {
      owner: await this.wallet.getAddress(),
      message: await this.processWriteString(message),
      createdAt: JSON.stringify(Date.now()),
      reactions: [],
      attachments: []
    };
    return new MemoVersion(version);
  }

  private async memoReaction(reactionEmoji: reactionEmoji): Promise<MemoReaction> {
    const reaction = {
      reaction: await this.processWriteString(reactionEmoji),
      owner: await this.wallet.getAddress(),
      createdAt: JSON.stringify(Date.now())
    };
    return new MemoReaction(reaction);
  }

  private async deleteReaction(reaction: string) {
    const currentState = await this.getCurrentState();
    const index = await this.getReactionIndex(currentState.versions[currentState.versions.length - 1].reactions, reaction);
    const newState = lodash.cloneDeepWith(currentState);
    newState.versions[newState.versions.length - 1].reactions.splice(index, 1);
    return newState;
  }

  private async getReactionIndex(reactions: MemoReaction[], reaction: string) {
    const address = await this.wallet.getAddress();
    const publicSigningKey = this.wallet.signingPublicKey();
    for (const [key, value] of Object.entries(reactions)) {
      if ((value.owner === address || value.address === address || value.publicSigningKey === publicSigningKey)
        && reaction === await this.processReadString(value.reaction)) {
        return key;
      }
    }
    throw new NotFound("Could not find reaction: " + reaction + " for given user.")
  }
};

type MemoCreateResult = {
  memoId: string,
  transactionId: string,
  object: Memo
}

type MemoUpdateResult = {
  transactionId: string,
  object: Memo
}

export {
  MemoService
}