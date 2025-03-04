import { Service } from "../core";
import { v4 as uuidv4 } from "uuid";
import { MembershipCreateOptions, MembershipService, activeStatus } from "./membership";
import { StackCreateOptions, StackService } from "./stack";
import { Node, NodeLike, NodeType, Stack } from "../types/node";
import { FileLike } from "../types/file";
import { BatchMembershipInviteResponse, BatchStackCreateResponse } from "../types/batch-response";
import { Membership, RoleType } from "../types/membership";
import { FileService, Hooks } from "./file";
import { actionRefs, functions, objectType, protocolTags } from "../constants";
import { ContractInput, Tag, Tags } from "../types/contract";
import { ObjectType } from "../types/object";
import { NodeService } from "./node";
import { BadRequest } from "../errors/bad-request";

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

class BatchService extends Service {

  public static BATCH_CHUNK_SIZE = 50;
  public static TRANSACTION_QUEUE_WAIT_TIME = 1;

  /**
   * @param  {{id:string,type:NoteType}[]} items
   * @returns Promise with corresponding transaction ids
   */
  public async revoke<T extends Node>(items: { id: string, type: NodeType }[])
    : Promise<{ transactionId: string, object: T }[]> {
    return this.batchUpdate<T>(items.map((item) => ({
      ...item,
      input: { function: functions.NODE_REVOKE },
      actionRef: item.type.toUpperCase() + "_REVOKE"
    })));
  }

  /**
   * @param  {{id:string,type:NoteType}[]} items
   * @returns Promise with corresponding transaction ids
   */
  public async restore<T extends Node>(items: { id: string, type: NodeType }[])
    : Promise<{ transactionId: string, object: T }[]> {
    return this.batchUpdate<T>(items.map((item) => ({
      ...item,
      input: { function: functions.NODE_RESTORE },
      actionRef: item.type.toUpperCase() + "_RESTORE"
    })));
  }

  /**
   * @param  {{id:string,type:NodeType}[]} items
   * @returns Promise with corresponding transaction ids
   */
  public async delete<T extends Node>(items: { id: string, type: NodeType }[])
    : Promise<{ transactionId: string, object: T }[]> {
    return this.batchUpdate<T>(items.map((item) => ({
      ...item,
      input: { function: functions.NODE_DELETE },
      actionRef: item.type.toUpperCase() + "_DELETE"
    })));
  }

  /**
   * @param  {{id:string,type:NodeType}[]} items
   * @returns Promise with corresponding transaction ids
   */
  public async move<T extends Node>(items: { id: string, type: NodeType }[], parentId?: string)
    : Promise<{ transactionId: string, object: T }[]> {
    return this.batchUpdate<T>(items.map((item) => ({
      ...item,
      input: {
        function: functions.NODE_MOVE,
        parentId: parentId
      },
      actionRef: item.type.toUpperCase() + "_MOVE"
    })));
  }

  /**
   * @param  {{id:string,role:RoleType}[]} items
   * @returns Promise with corresponding transaction ids
   */
  public async membershipChangeRole(items: { id: string, role: RoleType }[])
    : Promise<{ transactionId: string, object: Membership }[]> {
    return this.batchUpdate<Membership>(items.map((item) => ({
      id: item.id,
      type: objectType.MEMBERSHIP,
      input: {
        function: functions.MEMBERSHIP_CHANGE_ROLE,
        role: item.role
      },
      actionRef: actionRefs.MEMBERSHIP_CHANGE_ROLE
    })));
  }

  /**
   * @param  {string} vaultId
   * @param  {{file:FileLike,name:string,options:StackCreateOptions}[]} items
   * @param  {BatchStackCreateOptions} [options]
   * @returns Promise with new stack ids & their corresponding transaction ids
   */
  public async stackCreate(
    vaultId: string,
    items: StackCreateItem[],
    options: BatchStackCreateOptions = {}
  ): Promise<BatchStackCreateResponse> {
    const size = items.reduce((sum, stack) => {
      return sum + stack.file.size;
    }, 0);
    let progress = 0;
    let processedStacksCount = 0;
    const perFileProgress = new Map();
    if (options.processingCountHook) {
      options.processingCountHook(processedStacksCount);
    }

    let data = [] as BatchStackCreateResponse["data"];
    const errors = [] as BatchStackCreateResponse["errors"];
    const transactions = [] as StackCreateTransaction[];

    if (options.progressHook) {
      const onProgress = options.progressHook
      const stackProgressHook = (localProgress: number, data: any) => {
        const stackBytesUploaded = Math.floor(localProgress / 100 * data.total)
        progress += stackBytesUploaded - (perFileProgress.get(data.id) || 0)
        perFileProgress.set(data.id, stackBytesUploaded);
        onProgress(Math.min(100, Math.round(progress / size * 100)));
      }
      options.progressHook = stackProgressHook;
    }

    // set service context
    const vault = await this.api.getVault(vaultId);
    this.setVault(vault);
    this.setVaultId(vaultId);
    this.setIsPublic(vault.public);
    await this.setMembershipKeys(vault);
    this.setGroupRef(items);
    this.setActionRef(actionRefs.STACK_CREATE);
    this.setFunction(functions.NODE_CREATE);

    const stackCreateOptions = {
      ...options,
      cacheOnly: this.vault.cacheOnly
    }

    for (const chunk of [...chunks(items, BatchService.BATCH_CHUNK_SIZE)]) {
      // upload file data & metadata
      Promise.all(chunk.map(async (item) => {
        const service = new StackService(this.wallet, this.api, this);

        const nodeId = uuidv4();
        service.setObjectId(nodeId);

        const createOptions = {
          ...stackCreateOptions,
          ...(item.options || {})
        }
        service.setAkordTags((service.isPublic ? [item.name] : []).concat(createOptions.tags));
        service.setParentId(createOptions.parentId);
        service.arweaveTags = await service.getTxTags();

        const fileService = new FileService(this.wallet, this.api, service);
        const fileUploadResult = await fileService.create(item.file, createOptions);
        const version = await fileService.newVersion(item.file, fileUploadResult);

        const state = {
          name: await service.processWriteString(item.name ? item.name : item.file.name),
          versions: [version],
          tags: service.tags
        };
        const id = await service.uploadState(state);
        
        processedStacksCount += 1;
        if (options.processingCountHook) {
          options.processingCountHook(processedStacksCount);
        }

        // queue the stack transaction for posting
        transactions.push({
          vaultId: service.vaultId,
          input: { function: service.function, data: id, parentId: createOptions.parentId },
          tags: service.arweaveTags,
          item
        });
      }
      ));
    }

    // post queued stack transactions
    let currentTx: StackCreateTransaction;
    let stacksCreated = 0;
    while (stacksCreated < items.length) {
      if (options.cancelHook?.signal.aborted) {
        return { data, errors, cancelled: items.length - stacksCreated };
      }
      if (transactions.length === 0) {
        // wait for a while if the queue is empty before checking again
        await new Promise((resolve) => setTimeout(resolve, BatchService.TRANSACTION_QUEUE_WAIT_TIME));
      } else {
        try {
          currentTx = transactions.shift();
          // process the dequeued stack transaction
          const { id, object } = await this.api.postContractTransaction<Stack>(
            currentTx.vaultId,
            currentTx.input,
            currentTx.tags
          );
          if (options.onStackCreated) {
            await options.onStackCreated(object);
          }
          const stack = await new StackService(this.wallet, this.api, this)
            .processNode(object, !this.isPublic, this.keys);
          data.push({ transactionId: id, object: stack, stackId: object.id });
          stacksCreated += 1;
          if (options.cancelHook?.signal.aborted) {
            return { data, errors, cancelled: items.length - stacksCreated };
          }
        } catch (error) {

          errors.push({ name: currentTx.item.name, message: error.toString(), error });
        };
      }
    }
    if (options.cancelHook?.signal.aborted) {
      return { data, errors, cancelled: items.length - stacksCreated };
    }
    return { data, errors, cancelled: 0 };
  }

  /**
   * @param  {string} vaultId
   * @param  {{email:string,role:RoleType}[]} items
   * @param  {MembershipCreateOptions} [options] invitation email message, etc.
   * @returns Promise with new membership ids & their corresponding transaction ids
   */
  public async membershipInvite(vaultId: string, items: MembershipInviteItem[], options: MembershipCreateOptions = {})
    : Promise<BatchMembershipInviteResponse> {
    const members = await this.api.getMembers(vaultId);
    const data = [] as BatchMembershipInviteResponse["data"];
    const errors = [];

    const transactions = [] as MembershipInviteTransaction[];

    // set service context
    this.setGroupRef(items);
    const vault = await this.api.getVault(vaultId);
    this.setVault(vault);
    this.setVaultId(vaultId);
    this.setIsPublic(vault.public);
    await this.setMembershipKeys(vault);
    this.setActionRef(actionRefs.MEMBERSHIP_INVITE);
    this.setFunction(functions.MEMBERSHIP_INVITE);

    // upload metadata
    await Promise.all(items.map(async (item: MembershipInviteItem) => {
      const email = item.email.toLowerCase();
      const role = item.role;
      const member = members.find(item => item.email?.toLowerCase() === email);
      if (member && activeStatus.includes(member.status)) {
        const message = "Membership already exists for this user.";
        errors.push({ email: email, message, error: new BadRequest(message) });
      } else {
        const userHasAccount = await this.api.existsUser(email);
        const service = new MembershipService(this.wallet, this.api, this);
        if (userHasAccount) {
          const membershipId = uuidv4();
          service.setObjectId(membershipId);

          const { address, publicKey, publicSigningKey } = await this.api.getUserPublicData(email);
          const state = {
            keys: await service.prepareMemberKeys(publicKey),
            encPublicSigningKey: await service.processWriteString(publicSigningKey)
          };

          service.arweaveTags = [new Tag(protocolTags.MEMBER_ADDRESS, address)]
            .concat(await service.getTxTags());

          const dataTxId = await service.uploadState(state);

          transactions.push({
            vaultId,
            input: { function: service.function, address, role, data: dataTxId },
            tags: service.arweaveTags,
            item: item
          });
        } else {
          try {
            const { id } = await this.api.inviteNewUser(vaultId, email, role, options.message);
            data.push({
              membershipId: id,
              transactionId: null
            })
          } catch (error: any) {
            errors.push({
              email: email,
              error: error,
              message: error.message,
              item: item
            })
          }
        }
      }
    }
    ));

    for (let tx of transactions) {
      try {
        const { id, object } = await this.api.postContractTransaction<Membership>(vaultId, tx.input, tx.tags, { message: options.message });
        const membership = await new MembershipService(this.wallet, this.api, this).processMembership(object as Membership, !this.isPublic, this.keys);
        data.push({ membershipId: membership.id, transactionId: id, object: membership });
      } catch (error: any) {
        errors.push({
          email: tx.item.email,
          error: error,
          message: error.message,
          item: tx.item
        })
      }
    }
    return { data: data, errors: errors };
  }

  private async batchUpdate<T>(items: { id: string, type: ObjectType, input: ContractInput, actionRef: string }[])
    : Promise<{ transactionId: string, object: T }[]> {
    this.setGroupRef(items);
    const result = [] as { transactionId: string, object: T }[];
    for (const [itemIndex, item] of items.entries()) {
      const node = item.type === objectType.MEMBERSHIP
        ? await this.api.getMembership(item.id)
        : await this.api.getNode<NodeLike>(item.id, item.type);

      if (itemIndex === 0 || this.vaultId !== node.vaultId) {
        this.setVaultId(node.vaultId);
        this.setIsPublic(node.__public__);
        await this.setMembershipKeys(node);
      }
      const service = item.type === objectType.MEMBERSHIP
        ? new MembershipService(this.wallet, this.api, this)
        : new NodeService<T>(this.wallet, this.api, this);

      service.setFunction(item.input.function);
      service.setActionRef(item.actionRef);
      service.setObject(node);
      service.setObjectId(item.id);
      service.setObjectType(item.type);
      service.arweaveTags = await service.getTxTags();
      const { id, object } = await this.api.postContractTransaction<T>(this.vaultId, item.input, service.arweaveTags);
      const processedObject = item.type === objectType.MEMBERSHIP
        ? await (<MembershipService>service).processMembership(object as Membership, !this.isPublic, this.keys)
        : await (<NodeService<T>>service).processNode(object as any, !this.isPublic, this.keys) as any;
      result.push({ transactionId: id, object: processedObject });
    }
    return result;
  }

  public setGroupRef(items: any) {
    this.groupRef = items && items.length > 1 ? uuidv4() : null;
  }
}

export type BatchStackCreateOptions = Hooks & {
  processingCountHook?: (count: number) => void,
  onStackCreated?: (item: Stack) => Promise<void>
};

export type TransactionPayload = {
  vaultId: string,
  input: ContractInput,
  tags: Tags
}

export type StackCreateTransaction = TransactionPayload & {
  item: StackCreateItem
}

export type MembershipInviteTransaction = TransactionPayload & {
  item: MembershipInviteItem
}

export type StackCreateItem = {
  file: FileLike,
  name: string,
  options?: StackCreateOptions
}

export type MembershipInviteItem = {
  email: string,
  role: RoleType
}

export {
  BatchService
}
