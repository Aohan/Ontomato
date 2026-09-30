import { ontologyText, type ManagerMessages } from "./i18n";

export type ManagerCredential =
  | { type: "token"; token: string }
  | { type: "apiKey"; apiKey: string }
  | { type: "anonymous" };

/**
 * The two data defaults supplied statically by the host. They pre-fill edit forms or are submitted with save payloads,
 * so they are data, not UI text, and do not change with the UI locale or credential type. Each shell passes its own
 * values (open source: "No business description provided", "Unnamed asset").
 */
export interface ManagerDataFallbacks {
  /** Description used when an object type has no (empty) business description. */
  readonly noBusinessDescription: string;
  /** Name used when a smart asset's name is not a string. */
  readonly unnamedAsset: string;
}

export interface ManagerRequestContext {
  /** Data engine proxy entry without a trailing slash; requests go to `${apiBase}/data-query/*`. */
  readonly apiBase: string;
  /** null means the host has cleared or not yet obtained a credential: no business request is sent and it is not treated as anonymous. */
  readonly credential: ManagerCredential | null;
  readonly locale: string;
  /** Messages for the current locale, supplied by the host. */
  readonly messages: ManagerMessages;
  readonly dataFallbacks: ManagerDataFallbacks;
}

/** 401 means authentication expired and 402 a license failure; the host decides how to handle them. */
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
 * Host identity: API entry and credential (by value). A change means a different data source or user: the root component
 * rebuilds the workspace and the request layer drops stale responses. The locale is not part of the identity (as in the
 * original main system); it only sets Accept-Language on each request.
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
  /** Primary key attribute the backend saves with the class (an enabled varchar); must be id for the M3 data source. */
  primaryKeyName: string;
  showName: string;
  classDesc: string;
  /** Visual modeling submits false explicitly when creating a class. */
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
  /** Join fields submitted when visual modeling connects classes. */
  fromField?: string;
  toField?: string;
}

/** A business knowledge entry (the data engine KnowledgeEntity fields this page reads and writes); status 0 is pending review, 1 approved. */
export interface BusinessKnowledge {
  knowledgeID: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  status: number;
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
 * Data engine request layer, one per Manager workspace instance. Each request reads the current context values.
 * If apiBase or the credential changed by the time the response or its JSON arrives, the result is dropped (AbortError)
 * without notifying the host or delivering data; when only the locale changed, in-flight results for the same identity
 * are delivered and later requests carry the new locale. After dispose (workspace unmounted) no request is sent, so stale
 * follow-ups of confirmations or multi-step operations never go out with the new context.
 */
export function createManagerClient(
  context: ManagerRequestContext,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  let disposed = false;
  const stale = () =>
    new DOMException(ontologyText(context.messages, "staleResponseDropped"), "AbortError");

  async function send(path: string, init: { method: "GET" | "POST"; body?: string }) {
    if (disposed) throw stale();
    const credential = context.credential;
    if (!credential) throw new Error(ontologyText(context.messages, "credentialMissing"));
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
        ontologyText(context.messages, "requestFailedStatus", { status: response.status })
      );
    }
    const json = await response.json();
    assertCurrent();
    if (json?.success === false) {
      throw new Error(json.message || json.error || ontologyText(context.messages, "requestFailed"));
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

  /** Raw metadata; data browsing and visual modeling read their own fields. */
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

  /** search is submitted only when a non-empty keyword was entered in data browsing. */
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

  /** Visual modeling reads data.dataAdapter (the current adapter type). */
  function getBusinessConfig() {
    return send("/businessConfig/getConfig", { method: "GET" });
  }

  /** Data adapters installed in this edition; visual modeling uses the current type's sql flag to decide whether to show join fields. */
  function listDataAdapters() {
    return send("/businessConfig/dataAdapters", { method: "GET" });
  }

  /** Business knowledge list: the data engine returns an object keyed by knowledgeID; older entries may have no tags. */
  async function listKnowledge(): Promise<BusinessKnowledge[]> {
    const response = await post("/admin/getBussinessKnowledge", {});
    const entries = response.data as Record<
      string,
      Omit<BusinessKnowledge, "knowledgeTags"> & { knowledgeTags?: string[] }
    >;
    return Object.values(entries).map((item) => ({
      knowledgeID: item.knowledgeID,
      knowledgeTitle: item.knowledgeTitle,
      knowledgeText: item.knowledgeText,
      knowledgeTags: item.knowledgeTags ?? [],
      status: item.status,
    }));
  }

  /** Create (empty knowledgeID) or edit a business knowledge entry. */
  function saveKnowledge(knowledge: BusinessKnowledge) {
    return post(
      knowledge.knowledgeID ? "/admin/editBussinessKnowledge" : "/admin/addBussinessKnowledge",
      { ...knowledge }
    );
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
    saveKnowledge,
    deleteKnowledge,
  };
}
