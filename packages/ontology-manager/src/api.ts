import { ontologyText } from "./i18n";

export type ManagerCredential =
  | { type: "token"; token: string }
  | { type: "apiKey"; apiKey: string }
  | { type: "anonymous" };

/**
 * 宿主静态装配的两个数据默认值：它们会预填进编辑表单或随保存载荷提交，属于数据语义，
 * 不随界面语言、凭据种类变化。两版外壳各传原值（企业「未填写业务说明」「未命名资产」，
 * 开源 "No business description provided"、"Unnamed asset"）。
 */
export interface ManagerDataFallbacks {
  /** 对象类型没有业务说明（空值）时使用的说明。 */
  readonly noBusinessDescription: string;
  /** 智能资产的 name 不是字符串时使用的名称。 */
  readonly unnamedAsset: string;
}

export interface ManagerRequestContext {
  /** DataRAG 代理入口，不含末尾斜杠；请求发往 `${apiBase}/data-query/*`。 */
  readonly apiBase: string;
  /** null 表示宿主已清除或尚未取得凭据：不发业务请求，也不当作匿名。 */
  readonly credential: ManagerCredential | null;
  readonly locale: string;
  readonly dataFallbacks: ManagerDataFallbacks;
}

/** 401 为认证失效，402 为 License 失败；如何处理由宿主决定。 */
export type ManagerAuthFailureStatus = 401 | 402;

function credentialIdentity(credential: ManagerCredential | null) {
  if (!credential) return null;
  switch (credential.type) {
    case "token":
      return `token:${credential.token}`;
    case "apiKey":
      return `apiKey:${credential.apiKey}`;
    case "anonymous":
      return "anonymous";
  }
}

/**
 * 宿主身份：API 入口与凭据（按值）。变化即换了数据来源或用户：根组件据此重建工作区，请求层据此丢弃旧响应。
 * 语言不属于身份（与原主系统一致）：只决定每次发送时的 Accept-Language。
 */
export function hostSource(context: ManagerRequestContext) {
  return JSON.stringify([context.apiBase, credentialIdentity(context.credential)]);
}

function credentialHeaders(credential: ManagerCredential): Record<string, string> {
  switch (credential.type) {
    case "token":
      return { tk: credential.token };
    case "apiKey":
      return { "x-api-key": credential.apiKey };
    case "anonymous":
      return {};
  }
}

export type SmartAssetKind = "metrics" | "actions" | "functions" | "tasks";

const smartAssetPaths: Record<SmartAssetKind, string> = {
  metrics: "/metricView",
  actions: "/action",
  functions: "/function",
  tasks: "/writeTask",
};

export interface OntologyAttribute {
  name: string;
  showName: string;
  type: string;
  attrDesc?: string;
  bizzkeyBool?: boolean;
  primaryKey?: boolean;
  enable?: boolean;
}

export interface OntologyObject {
  className: string;
  showName: string;
  classDesc: string;
  attrs: OntologyAttribute[];
}

export interface OntologyRelation {
  relationship: string;
  showName: string;
  fromclass: string;
  toclass: string;
  desc: string;
}

export interface CreateOntologyObjectInput {
  className: string;
  showName: string;
  classDesc: string;
  /** 可视化建模新建类时显式提交 false。 */
  classToCard?: boolean;
  instanceToCard?: boolean;
  inStarChart?: boolean;
}

export interface CreateOntologyAttributeInput {
  className: string;
  name: string;
  showName: string;
  type: string;
  attrDesc: string;
  enable: boolean;
  bizzKey: boolean;
  primaryKey?: boolean;
}

export interface CreateOntologyRelationInput {
  relationship: string;
  fromclass: string;
  toclass: string;
  desc: string;
  /** 可视化建模连线时提交的关联字段。 */
  fromField?: string;
  toField?: string;
}

export interface SmartAsset {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  origin?: string;
  modifyTimestamp?: number;
  function?: { name?: string } | null;
  [key: string]: unknown;
}

export type ManagerClient = ReturnType<typeof createManagerClient>;

/**
 * 每个 Manager 工作区实例一份的 DataRAG 请求层。每次请求读取 context 的当前值；
 * 响应返回或 JSON 读完时 apiBase 或凭据已变化则丢弃（AbortError），不通知宿主也不交付数据；
 * 只有语言变化时同一身份的在途结果照常交付，之后的请求带新语言。
 * dispose 后（工作区已卸载）不再发出任何请求：确认框或多步操作的旧后续不会带着新上下文发送。
 */
export function createManagerClient(
  context: ManagerRequestContext,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  let disposed = false;
  const stale = () =>
    new DOMException(ontologyText(context.locale, "staleResponseDropped"), "AbortError");

  async function send(path: string, init: { method: "GET" | "POST"; body?: string }) {
    if (disposed) throw stale();
    const credential = context.credential;
    if (!credential) throw new Error(ontologyText(context.locale, "credentialMissing"));
    const source = hostSource(context);
    const assertCurrent = () => {
      if (disposed || hostSource(context) !== source) throw stale();
    };

    const response = await fetch(`${context.apiBase}/data-query${path}`, {
      ...init,
      headers: {
        ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
        "Accept-Language": context.locale,
        "X-Requested-With": "XMLHttpRequest",
        ...credentialHeaders(credential),
      },
    });
    assertCurrent();
    if (response.status === 401 || response.status === 402) onAuthFailure(response.status);
    if (!response.ok) {
      throw new Error(
        ontologyText(context.locale, "requestFailedStatus", { status: response.status })
      );
    }
    const json = await response.json();
    assertCurrent();
    if (json?.success === false) {
      throw new Error(json.message || json.error || ontologyText(context.locale, "requestFailed"));
    }
    return json;
  }

  const post = (path: string, body: Record<string, unknown>) =>
    send(path, { method: "POST", body: JSON.stringify(body) });

  function requestSmartAsset(
    kind: SmartAssetKind,
    operation: string,
    body: Record<string, unknown>
  ) {
    return post(`${smartAssetPaths[kind]}/${operation}`, body);
  }

  /** 原始元数据；数据浏览与可视化建模按各自字段读取。 */
  function getMetas() {
    return post("/admin/getMetas", {});
  }

  async function loadOntology() {
    const response = await getMetas();
    const data = response.data || {};
    const objects = (data.classDef || []).map((item: Record<string, any>) => ({
      className: item.className,
      showName: item.showName || item.classDesc || item.className,
      classDesc: item.classDesc || context.dataFallbacks.noBusinessDescription,
      attrs: (item.attrs || []).map((attr: Record<string, any>) => ({
        name: attr.name,
        showName: attr.showName || attr.name,
        type: attr.type || "string",
        attrDesc: attr.attrDesc || "",
        enable: attr.enable !== false && String(attr.enable || "").toLowerCase() !== "false",
        bizzkeyBool:
          attr.bizzkeyBool === true ||
          attr.bizzkey === true ||
          String(attr.bizzkey || "")
            .trim()
            .toLowerCase() === "true",
        primaryKey:
          attr.primaryKey === true ||
          attr.primary_key === true ||
          String(attr.primaryKey ?? attr.primary_key ?? "")
            .trim()
            .toLowerCase() === "true",
      })),
    })) as OntologyObject[];
    const relationSource = data.relationDef || data.relations || data.relationship_rule || [];
    const relations = (
      Array.isArray(relationSource)
        ? relationSource
        : Object.entries(relationSource).map(([relationship, relation]) => ({
            ...(relation as Record<string, unknown>),
            relationship,
          }))
    ).map((item: Record<string, any>) => ({
      relationship: item.relationship,
      showName:
        item.showName ||
        item.relationShowName ||
        item.relationshipShowName ||
        item.desc ||
        item.relationship,
      fromclass: item.fromclass,
      toclass: item.toclass,
      desc: item.desc || item.relationship,
    })) as OntologyRelation[];
    return { objects, relations };
  }

  function createOntologyObject(input: CreateOntologyObjectInput) {
    return post("/admin/addClass", { ...input });
  }

  async function updateOntologyObject(
    className: string,
    changes: { showName?: string; classDesc?: string }
  ) {
    const requests: Promise<unknown>[] = [];
    if (changes.showName !== undefined) {
      requests.push(post("/admin/editClassShowName", { className, showName: changes.showName }));
    }
    if (changes.classDesc !== undefined) {
      requests.push(post("/admin/editClassDesc", { className, desc: changes.classDesc }));
    }
    await Promise.all(requests);
  }

  function deleteOntologyObject(className: string) {
    return post("/admin/delClass", { className });
  }

  async function updateOntologyAttribute(
    className: string,
    attr: OntologyAttribute,
    changes: {
      showName?: string;
      attrDesc?: string;
      enable?: boolean;
      bizzkeyBool?: boolean;
      primaryKey?: boolean;
    }
  ) {
    const requests: Promise<unknown>[] = [];
    if (changes.showName !== undefined) {
      requests.push(
        post("/admin/editClassAttrShowName", {
          className,
          attr: attr.name,
          showName: changes.showName,
        })
      );
    }
    if (changes.attrDesc !== undefined || changes.enable !== undefined) {
      requests.push(
        post("/admin/editClassAttrDesc", {
          className,
          attr: attr.name,
          desc: changes.attrDesc ?? attr.attrDesc ?? "",
          enable: String(changes.enable ?? attr.enable ?? true),
        })
      );
    }
    if (changes.bizzkeyBool !== undefined) {
      requests.push(
        post("/admin/editClassAttrShouldReturn", {
          className,
          attr: attr.name,
          shouldReturn: changes.bizzkeyBool,
        })
      );
    }
    if (changes.primaryKey) {
      requests.push(post("/admin/editClassAttrPrimaryKey", { className, attr: attr.name }));
    }
    await Promise.all(requests);
  }

  async function createOntologyAttribute(input: CreateOntologyAttributeInput) {
    await post("/admin/addClassAttr", {
      className: input.className,
      attrName: input.name,
      showName: input.showName,
      attrDesc: input.attrDesc,
      type: input.type,
      bizzKey: input.bizzKey,
      enable: input.enable,
    });

    if (input.primaryKey) {
      await post("/admin/editClassAttrPrimaryKey", {
        className: input.className,
        attr: input.name,
      });
    }
  }

  function deleteOntologyAttribute(className: string, attrName: string) {
    return post("/admin/delClassAttr", { className, attrName });
  }

  function updateOntologyRelation(relationship: string, desc: string) {
    return post("/admin/editRelationshipDesc", { relationship, desc });
  }

  function createOntologyRelation(input: CreateOntologyRelationInput) {
    return post("/admin/addRelationship", {
      relationName: input.relationship,
      fromClassName: input.fromclass,
      toClassName: input.toclass,
      relationDesc: input.desc,
      fromField: input.fromField,
      toField: input.toField,
    });
  }

  function deleteOntologyRelation(relationName: string) {
    return post("/admin/delRelationship", { relationName });
  }

  /** search 仅在数据浏览输入了非空关键词时提交。 */
  async function loadObjectData(
    className: string,
    page: number,
    pageSize: number,
    search?: string
  ) {
    const response = await post("/data/getWholeClassDataByPage", {
      classname: className,
      pagenum: page,
      pagecount: pageSize,
      search,
    });
    return {
      rows: Array.isArray(response.data) ? response.data : [],
      total: Number(response.total_count || 0),
    };
  }

  async function loadSmartAssets(kind: SmartAssetKind) {
    const response = await post(`${smartAssetPaths[kind]}/queryList`, {});
    const source = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];
    return source.map((asset: Record<string, unknown>) => ({
      ...asset,
      id: typeof asset.id === "string" ? asset.id : undefined,
      name: typeof asset.name === "string" ? asset.name : context.dataFallbacks.unnamedAsset,
      description: typeof asset.description === "string" ? asset.description : null,
      status: typeof asset.status === "string" ? asset.status : undefined,
      origin: typeof asset.origin === "string" ? asset.origin : undefined,
      modifyTimestamp:
        typeof asset.modifyTimestamp === "number" ? asset.modifyTimestamp : undefined,
      function: asset.function as SmartAsset["function"],
    })) as SmartAsset[];
  }

  /** 可视化建模读取 data.dataAdapter（当前适配器类型）。 */
  function getBusinessConfig() {
    return send("/businessConfig/getConfig", { method: "GET" });
  }

  /** 本版本已安装的数据适配器；可视化建模据当前类型的 sql 标记决定是否显示关联字段。 */
  function listDataAdapters() {
    return send("/businessConfig/dataAdapters", { method: "GET" });
  }

  /** 业务知识（DataRAG /admin/getBussinessKnowledge 等），供本体管理器内嵌的业务知识页使用。 */
  function listKnowledge() {
    return post("/admin/getBussinessKnowledge", {});
  }

  function addKnowledge(payload: Record<string, unknown>) {
    return post("/admin/addBussinessKnowledge", payload);
  }

  function editKnowledge(payload: Record<string, unknown>) {
    return post("/admin/editBussinessKnowledge", payload);
  }

  function deleteKnowledge(knowledgeID: string) {
    return post("/admin/delBussinessKnowledge", { knowledgeID });
  }

  return {
    dispose: () => {
      disposed = true;
    },
    requestSmartAsset,
    getMetas,
    loadOntology,
    createOntologyObject,
    updateOntologyObject,
    deleteOntologyObject,
    updateOntologyAttribute,
    createOntologyAttribute,
    deleteOntologyAttribute,
    updateOntologyRelation,
    createOntologyRelation,
    deleteOntologyRelation,
    loadObjectData,
    loadSmartAssets,
    getBusinessConfig,
    listDataAdapters,
    listKnowledge,
    addKnowledge,
    editKnowledge,
    deleteKnowledge,
  };
}
