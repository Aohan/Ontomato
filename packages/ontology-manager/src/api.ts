export type ManagerCredential =
  | { type: "token"; token: string }
  | { type: "apiKey"; apiKey: string }
  | { type: "anonymous" };

export interface ManagerRequestContext {
  /** DataRAG 代理入口，不含末尾斜杠；请求发往 `${apiBase}/data-query/*`。 */
  readonly apiBase: string;
  /** null 表示宿主已清除或尚未取得凭据：不发业务请求，也不当作匿名。 */
  readonly credential: ManagerCredential | null;
  readonly locale: string;
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

/** 决定一次请求语义的上下文：来源、语言与凭据（按值）。 */
function requestSource(context: ManagerRequestContext) {
  return JSON.stringify([context.apiBase, context.locale, credentialIdentity(context.credential)]);
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
 * 每个 Manager 实例一份的 DataRAG 请求层。每次请求读取 context 的当前值；
 * 响应返回或 JSON 读完时 apiBase、语言或凭据已变化则丢弃（AbortError），不通知宿主也不交付数据。
 */
export function createManagerClient(
  context: ManagerRequestContext,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  async function send(path: string, init: { method: "GET" | "POST"; body?: string }) {
    const credential = context.credential;
    if (!credential) throw new Error("未提供凭据");
    const source = requestSource(context);
    const assertCurrent = () => {
      if (requestSource(context) !== source) {
        throw new DOMException("宿主上下文已变化，已丢弃旧响应", "AbortError");
      }
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
    if (!response.ok) throw new Error(`请求失败 (${response.status})`);
    const json = await response.json();
    assertCurrent();
    if (json?.success === false) throw new Error(json.message || json.error || "请求失败");
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
      classDesc: item.classDesc || "未填写业务说明",
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
      name: typeof asset.name === "string" ? asset.name : "未命名资产",
      description: typeof asset.description === "string" ? asset.description : null,
      status: typeof asset.status === "string" ? asset.status : undefined,
      origin: typeof asset.origin === "string" ? asset.origin : undefined,
      modifyTimestamp:
        typeof asset.modifyTimestamp === "number" ? asset.modifyTimestamp : undefined,
      function: asset.function as SmartAsset["function"],
    })) as SmartAsset[];
  }

  /** 可视化建模据 data.dataAdapter 判断是否 SQL 适配器。 */
  function getBusinessConfig() {
    return send("/businessConfig/getConfig", { method: "GET" });
  }

  return {
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
  };
}
