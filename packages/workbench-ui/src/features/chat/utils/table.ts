// Table enhancement module — TypeScript version
// Features: header filtering (select all / invert / search / sort), row sorting (asc / desc), expand/collapse, multi-table linkage
// UI style: Element Plus design tokens

import { t } from "../../../i18n";


interface TableState {
  rows: HTMLTableRowElement[];
  texts: string[][];
  columnValues: Map<number, string[]>;
  valueCounts: Map<number, Map<string, number>>;
  columnFilters: Map<number, Set<string>>;
}

interface CollapseMeta {
  visibleCount: number;
  totalCount: number;
  detailsTemplate: HTMLElement;
}

const tableFilterCache = new WeakMap<HTMLTableElement, TableState>();
const tableGroupMap = new WeakMap<HTMLTableElement, HTMLTableElement[]>();
const rowSortState = new WeakMap<HTMLTableElement, Map<number, "asc" | "desc">>();
const tableCollapseMeta = new WeakMap<HTMLTableElement, CollapseMeta>();

let dropdownEl: HTMLDivElement | null = null;
let dropdownSearchInput: HTMLInputElement | null = null;
let dropdownListEl: HTMLDivElement | null = null;
let dropdownOutsideHandler: ((e: MouseEvent) => void) | null = null;
let sortNameBtn: HTMLButtonElement | null = null;
let sortCountBtn: HTMLButtonElement | null = null;
let rowAscBtn: HTMLButtonElement | null = null;
let rowDescBtn: HTMLButtonElement | null = null;

let activeFilterTable: HTMLTableElement | null = null;
let activeFilterColIndex = -1;
let dropdownCurrentOptions: string[] = [];
let dropdownCurrentSelected = new Set<string>();
let dropdownValueCountMap: Map<string, number> | null = null;
let dropdownSortMode: "name-asc" | "name-desc" | "count-asc" | "count-desc" = "name-asc";

const STYLE_ID = "ai-table-enhancer-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ai-th-filterable {
  position: relative;
  padding-right: 20px !important;
  cursor: pointer;
  user-select: none;
}
.ai-th-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-th-label { white-space: nowrap; }
.ai-th-filter-trigger {
  width: 0; height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--el-text-color-placeholder);
  margin-left: 2px;
  transition: transform .15s ease, border-top-color .15s ease;
}
.ai-th-filterable:hover .ai-th-filter-trigger { border-top-color: var(--el-color-primary); }
.ai-th-filtered .ai-th-filter-trigger { border-top-color: var(--el-color-primary); transform: translateY(1px); }

.ai-th-filter-dropdown {
  position: absolute; min-width: 260px; max-width: 400px; max-height: 360px;
  z-index: 999999; font-size: 13px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
}
.ai-th-filter-dropdown--hidden { display: none; }
.ai-th-filter-dropdown-inner { display: flex; flex-direction: column; padding: 10px; box-sizing: border-box; }

.ai-th-filter-toolbar { margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; }
.ai-th-filter-row-sort { display: flex; gap: 6px; }
.ai-th-filter-row-sort button {
  flex: 0 0 auto; padding: 4px 12px; border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank);
  cursor: pointer; font-size: 12px; color: var(--el-text-color-regular);
}
.ai-th-filter-row-sort button:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); }
.ai-th-filter-row-sort button.active { color: var(--el-color-primary); border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }

.ai-th-filter-toolbar-bottom { display: flex; align-items: center; gap: 6px; }
.ai-th-filter-search {
  flex: 1 1 auto; padding: 4px 8px; border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color); font-size: 12px; box-sizing: border-box;
  background: var(--el-fill-color-blank); color: var(--el-text-color-primary);
}
.ai-th-filter-search:focus { outline: none; border-color: var(--el-color-primary); }
.ai-th-filter-sort { display: flex; flex-shrink: 0; gap: 4px; }
.ai-th-filter-sort button {
  flex: 0 0 auto; padding: 4px 8px; border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank);
  cursor: pointer; font-size: 12px; color: var(--el-text-color-regular);
}
.ai-th-filter-sort button:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); }
.ai-th-filter-sort button.active { color: var(--el-color-primary); border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }

.ai-th-filter-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.ai-th-filter-actions button {
  font-size: 12px; flex: 0 0 auto; padding: 2px 8px;
  border-radius: var(--el-border-radius-base); border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank); cursor: pointer; color: var(--el-text-color-regular);
}
.ai-th-filter-actions button:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); }

.ai-th-filter-list { min-height: 80px; max-height: 200px; overflow: auto; padding: 6px;
  box-sizing: border-box; border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-blank); }
.ai-th-filter-item { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
.ai-th-filter-item input[type=checkbox] { flex: 0 0 auto; accent-color: var(--el-color-primary); }
.ai-th-filter-item-text { flex: 1 1 auto; word-break: break-all; font-size: 12px; }
.ai-th-filter-empty { padding: 8px 4px; color: var(--el-text-color-placeholder); font-size: 12px; }

.ai-th-filter-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.ai-th-filter-footer button {
  padding: 4px 14px; border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank);
  cursor: pointer; font-size: 12px; color: var(--el-text-color-regular);
}
.ai-th-filter-footer button.primary { background: var(--el-color-primary); border-color: var(--el-color-primary); color: #fff; }
.ai-th-filter-footer button.primary:hover { background: var(--el-color-primary-light-3); border-color: var(--el-color-primary-light-3); }

/* Expand / collapse */
.ai-table-more-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer; user-select: none;
  color: var(--el-color-primary); font-size: 13px;
}
.ai-table-more-toggle::before {
  content: ''; display: inline-block; width: 0; height: 0;
  border-top: 4px solid transparent; border-bottom: 4px solid transparent;
  border-left: 6px solid var(--el-color-primary); margin-right: 4px;
  transition: transform .15s ease;
}
.ai-table-more-toggle[data-ai-state=expanded]::before { transform: rotate(-90deg); }
details[data-ai-table-details='1'] > summary.ai-table-more-toggle::marker { content: ''; }
`;
  document.head.appendChild(style);
}

function normalizeCellText(td: HTMLTableCellElement): string {
  return (td.textContent || "").trim();
}

function collectTableData(tableEl: HTMLTableElement): TableState | null {
  const tbody = tableEl.tBodies[0];
  if (!tbody) return null;

  const rows = Array.from(tbody.rows);
  const texts: string[][] = [];
  const columnValuesMap = new Map<number, string[]>();
  const valueCountsMap = new Map<number, Map<string, number>>();

  rows.forEach((tr, rowIndex) => {
    const tds = Array.from(tr.cells);
    const rowTexts = tds.map((td) => normalizeCellText(td));
    texts[rowIndex] = rowTexts;

    rowTexts.forEach((val, colIndex) => {
      if (!val) return;
      if (!columnValuesMap.has(colIndex)) columnValuesMap.set(colIndex, []);
      const list = columnValuesMap.get(colIndex)!;
      if (!list.includes(val)) list.push(val);

      if (!valueCountsMap.has(colIndex)) valueCountsMap.set(colIndex, new Map());
      const counts = valueCountsMap.get(colIndex)!;
      counts.set(val, (counts.get(val) || 0) + 1);
    });
  });

  return {
    rows,
    texts,
    columnValues: columnValuesMap,
    valueCounts: valueCountsMap,
    columnFilters: new Map(),
  };
}

function getOrInitTableState(tableEl: HTMLTableElement): TableState | null {
  let state = tableFilterCache.get(tableEl);
  if (!state) {
    state = collectTableData(tableEl) ?? undefined;
    if (state) tableFilterCache.set(tableEl, state);
  }
  return state || null;
}

function compareCellValues(a: string, b: string): number {
  const cleanA = a.replace(/,/g, "").trim();
  const cleanB = b.replace(/,/g, "").trim();
  const na = cleanA === "" ? NaN : Number(cleanA);
  const nb = cleanB === "" ? NaN : Number(cleanB);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "zh-Hans-CN");
}

function sortTablesByColumn(
  masterTable: HTMLTableElement,
  colIndex: number,
  direction: "asc" | "desc"
): void {
  if (!masterTable || colIndex < 0) return;
  const group = tableGroupMap.get(masterTable) || [masterTable];
  const factor = direction === "desc" ? -1 : 1;

  if (group.length === 1) {
    const tableEl = group[0];
    const state = getOrInitTableState(tableEl);
    if (!state) return;
    const { rows, texts } = state;
    const tbody = tableEl.tBodies[0];
    if (!tbody) return;

    const indices = rows.map((_, idx) => idx);
    indices.sort((i1, i2) => {
      const v1 = (texts[i1] && texts[i1][colIndex]) || "";
      const v2 = (texts[i2] && texts[i2][colIndex]) || "";
      return compareCellValues(v1, v2) * factor;
    });

    const newRows: HTMLTableRowElement[] = [];
    const newTexts: string[][] = [];
    indices.forEach((i) => {
      const row = rows[i];
      newRows.push(row);
      newTexts.push(texts[i]);
      tbody.appendChild(row);
    });
    state.rows = newRows;
    state.texts = newTexts;
    return;
  }

  const states = group.map((t) => getOrInitTableState(t));
  const tbodies = group.map((t) => t.tBodies[0]);
  const limits = states.map((st) => (st ? st.rows.length : 0));
  const items: { rowEl: HTMLTableRowElement; texts: string[] }[] = [];

  states.forEach((st, ti) => {
    if (!st || !tbodies[ti]) return;
    st.rows.forEach((tr, ri) => items.push({ rowEl: tr, texts: st.texts[ri] || [] }));
  });

  items.sort((a, b) => {
    const v1 = a.texts[colIndex] ?? "";
    const v2 = b.texts[colIndex] ?? "";
    return compareCellValues(v1, v2) * factor;
  });

  const newRowsByTable: HTMLTableRowElement[][] = states.map(() => []);
  const newTextsByTable: string[][][] = states.map(() => []);

  tbodies.forEach((tbody) => {
    if (tbody) tbody.innerHTML = "";
  });

  let cursor = 0;
  group.forEach((tableEl, ti) => {
    const tbody = tbodies[ti];
    const state = states[ti];
    if (!tbody || !state) return;
    const count = limits[ti];
    for (let k = 0; k < count && cursor < items.length; k++) {
      const item = items[cursor++];
      tbody.appendChild(item.rowEl);
      newRowsByTable[ti].push(item.rowEl);
      newTextsByTable[ti].push(item.texts);
    }
  });

  states.forEach((st, ti) => {
    if (!st) return;
    st.rows = newRowsByTable[ti];
    st.texts = newTextsByTable[ti];
  });
}

function updateHeaderFilterState(tableEl: HTMLTableElement): void {
  const thead = tableEl.tHead;
  if (!thead || !thead.rows.length) return;
  const ths = Array.from(thead.rows[0].cells);
  const state = tableFilterCache.get(tableEl);
  if (!state) return;
  ths.forEach((th, idx) => {
    const filtered = state.columnFilters.has(idx) && (state.columnFilters.get(idx)?.size ?? 0) > 0;
    th.classList.toggle("ai-th-filtered", filtered);
  });
}

function applyFiltersForTable(tableEl: HTMLTableElement): void {
  const state = tableFilterCache.get(tableEl);
  if (!state) return;
  const { rows, texts, columnFilters } = state;
  rows.forEach((tr, rowIndex) => {
    const rowTexts = texts[rowIndex] || [];
    const hit = Array.from(columnFilters.entries()).every(([colIndex, set]) => {
      if (!set || set.size === 0) return true;
      return set.has(rowTexts[colIndex] || "");
    });
    tr.style.display = hit ? "" : "none";
  });
  updateHeaderFilterState(tableEl);
}

function ensureDropdown(): void {
  if (dropdownEl) return;
  dropdownEl = document.createElement("div");
  dropdownEl.className = "ai-th-filter-dropdown ai-th-filter-dropdown--hidden";
  dropdownEl.innerHTML = `
    <div class="ai-th-filter-dropdown-inner">
      <div class="ai-th-filter-toolbar">
        <div class="ai-th-filter-row-sort">
          <button type="button" data-action="row-asc">${t("common.ascending")}</button>
          <button type="button" data-action="row-desc">${t("common.descending")}</button>
        </div>
        <div class="ai-th-filter-toolbar-bottom">
          <input class="ai-th-filter-search" type="text" placeholder="${t("admin.searchColumn")}" />
          <div class="ai-th-filter-sort">
            <button type="button" data-action="sort-name" class="active">${t("common.name")} ↑</button>
            <button type="button" data-action="sort-count">${t("common.count")} ↑</button>
          </div>
        </div>
      </div>
      <div class="ai-th-filter-actions">
        <button type="button" data-action="select-all">${t("common.selectAll")}</button>
        <button type="button" data-action="invert">${t("common.invertSelection")}</button>
      </div>
      <div class="ai-th-filter-list"></div>
      <div class="ai-th-filter-footer">
        <button type="button" data-action="ok" class="primary">${t("common.ok")}</button>
        <button type="button" data-action="cancel">${t("common.cancel")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dropdownEl);

  dropdownSearchInput = dropdownEl.querySelector(".ai-th-filter-search");
  dropdownListEl = dropdownEl.querySelector(".ai-th-filter-list");
  sortNameBtn = dropdownEl.querySelector('[data-action="sort-name"]');
  sortCountBtn = dropdownEl.querySelector('[data-action="sort-count"]');
  rowAscBtn = dropdownEl.querySelector('[data-action="row-asc"]');
  rowDescBtn = dropdownEl.querySelector('[data-action="row-desc"]');

  dropdownEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (!action) return;

    if (action === "row-asc" || action === "row-desc") {
      if (!activeFilterTable || activeFilterColIndex < 0) return;
      const dir = action === "row-asc" ? ("asc" as const) : ("desc" as const);
      sortTablesByColumn(activeFilterTable, activeFilterColIndex, dir);

      let map = rowSortState.get(activeFilterTable);
      if (!map) {
        map = new Map();
        rowSortState.set(activeFilterTable, map);
      }
      map.clear();
      map.set(activeFilterColIndex, dir);

      rowAscBtn?.classList.toggle("active", dir === "asc");
      rowDescBtn?.classList.toggle("active", dir === "desc");
      return;
    }

    if (action === "sort-name") {
      dropdownSortMode = dropdownSortMode === "name-asc" ? "name-desc" : "name-asc";
      if (sortNameBtn) {
        sortNameBtn.classList.add("active");
        sortNameBtn.textContent =
          t("common.name") + " " + (dropdownSortMode === "name-asc" ? "↑" : "↓");
      }
      sortCountBtn?.classList.remove("active");
      if (sortCountBtn) sortCountBtn.textContent = t("common.count") + " ↑";
      renderDropdownOptions();
      return;
    }

    if (action === "sort-count") {
      dropdownSortMode = dropdownSortMode === "count-asc" ? "count-desc" : "count-asc";
      if (sortCountBtn) {
        sortCountBtn.classList.add("active");
        sortCountBtn.textContent =
          t("common.count") + " " + (dropdownSortMode === "count-asc" ? "↑" : "↓");
      }
      sortNameBtn?.classList.remove("active");
      if (sortNameBtn) sortNameBtn.textContent = t("common.name") + " ↑";
      renderDropdownOptions();
      return;
    }

    if (action === "select-all") {
      dropdownCurrentSelected = new Set(dropdownCurrentOptions);
      renderDropdownOptions();
    } else if (action === "invert") {
      const total = dropdownCurrentOptions.length;
      if (dropdownCurrentSelected.size === 0) {
        dropdownCurrentSelected = new Set(dropdownCurrentOptions);
      } else if (dropdownCurrentSelected.size === total) {
        dropdownCurrentSelected = new Set();
      } else {
        const next = new Set<string>();
        dropdownCurrentOptions.forEach((v) => {
          if (!dropdownCurrentSelected.has(v)) next.add(v);
        });
        dropdownCurrentSelected = next;
      }
      renderDropdownOptions();
    } else if (action === "ok") {
      applyDropdownSelection();
      hideDropdown();
    } else if (action === "cancel") {
      hideDropdown();
    }
  });

  dropdownListEl!.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement | null;
    if (!target || target.type !== "checkbox") return;
    if (target.checked) dropdownCurrentSelected.add(target.value);
    else dropdownCurrentSelected.delete(target.value);
  });

  dropdownSearchInput!.addEventListener("input", () => renderDropdownOptions());

  dropdownOutsideHandler = (e: MouseEvent) => {
    if (!dropdownEl || dropdownEl.classList.contains("ai-th-filter-dropdown--hidden")) return;
    const target = e.target as Node | null;
    if (target && dropdownEl.contains(target)) return;
    hideDropdown();
  };
  window.addEventListener("click", dropdownOutsideHandler);
}

function renderDropdownOptions(): void {
  if (!dropdownListEl) return;
  const keyword = (dropdownSearchInput?.value || "").trim().toLowerCase();
  dropdownListEl.innerHTML = "";

  let filtered = dropdownCurrentOptions.filter((val) =>
    !keyword ? true : val.toLowerCase().includes(keyword)
  );

  const counts = dropdownValueCountMap || new Map();
  const byName = dropdownSortMode.startsWith("name");
  const asc = dropdownSortMode.endsWith("asc");

  filtered = filtered.slice().sort((a, b) => {
    if (byName) {
      const res = a.localeCompare(b, "zh-Hans-CN");
      return asc ? res : -res;
    }
    const ca = counts.get(a) || 0;
    const cb = counts.get(b) || 0;
    const res = ca - cb;
    return asc ? res : -res;
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "ai-th-filter-empty";
    empty.textContent = t("admin.noOptions");
    dropdownListEl.appendChild(empty);
    return;
  }

  filtered.forEach((val) => {
    const wrapper = document.createElement("label");
    wrapper.className = "ai-th-filter-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = val;
    cb.checked = dropdownCurrentSelected.has(val);

    const text = document.createElement("span");
    text.className = "ai-th-filter-item-text";
    const count = counts.get(val) || 0;
    text.textContent = count ? `${val} (${count})` : val;

    wrapper.appendChild(cb);
    wrapper.appendChild(text);
    dropdownListEl!.appendChild(wrapper);
  });
}

function applyDropdownSelection(): void {
  if (!activeFilterTable || activeFilterColIndex < 0) return;
  const state = tableFilterCache.get(activeFilterTable);
  if (!state) return;

  const options = dropdownCurrentOptions;
  const selectedSize = dropdownCurrentSelected.size;
  if (selectedSize === 0 || selectedSize === options.length) {
    state.columnFilters.delete(activeFilterColIndex);
  } else {
    state.columnFilters.set(activeFilterColIndex, new Set(dropdownCurrentSelected));
  }

  const group = tableGroupMap.get(activeFilterTable) || [activeFilterTable];
  group.forEach((tableEl) => applyFiltersForTable(tableEl));
}

function hideDropdown(): void {
  dropdownEl?.classList.add("ai-th-filter-dropdown--hidden");
  activeFilterTable = null;
  activeFilterColIndex = -1;
}

function openDropdownForTh(
  tableEl: HTMLTableElement,
  thEl: HTMLTableCellElement,
  colIndex: number
): void {
  const state = getOrInitTableState(tableEl);
  if (!state) return;
  ensureDropdown();

  activeFilterTable = tableEl;
  activeFilterColIndex = colIndex;

  const counts = state.valueCounts.get(colIndex) || new Map();
  dropdownValueCountMap = counts;
  dropdownCurrentOptions = Array.from(counts.keys());

  const existingSet = state.columnFilters.get(colIndex);
  dropdownCurrentSelected =
    existingSet && existingSet.size > 0 ? new Set(existingSet) : new Set(dropdownCurrentOptions);

  dropdownSortMode = "name-asc";
  if (sortNameBtn) sortNameBtn.classList.add("active");
  if (sortCountBtn) sortCountBtn?.classList.remove("active");

  const sortMap = rowSortState.get(tableEl);
  const currentDir = sortMap?.get(colIndex);
  rowAscBtn?.classList.toggle("active", currentDir === "asc");
  rowDescBtn?.classList.toggle("active", currentDir === "desc");

  if (dropdownSearchInput) dropdownSearchInput.value = "";
  renderDropdownOptions();

  const rect = thEl.getBoundingClientRect();
  dropdownEl!.style.left = `${rect.left + window.scrollX}px`;
  dropdownEl!.style.top = `${rect.bottom + window.scrollY + 4}px`;
  dropdownEl!.classList.remove("ai-th-filter-dropdown--hidden");
}

function enhanceTableWithHeaderFilter(tableEl: HTMLTableElement): void {
  if (!tableEl || tableEl.dataset.aiFilterEnhanced === "1") return;
  const thead = tableEl.tHead;
  if (!thead || !thead.rows.length) return;

  const headerRow = thead.rows[0];
  const ths = Array.from(headerRow.cells);
  if (!ths.length) return;

  const state = getOrInitTableState(tableEl);
  if (!state) return;

  ths.forEach((th, index) => {
    if (th.querySelector(".ai-th-inner")) return;
    th.classList.add("ai-th-filterable");

    const labelText = th.textContent || "";
    th.textContent = "";

    const inner = document.createElement("div");
    inner.className = "ai-th-inner";

    const labelSpan = document.createElement("span");
    labelSpan.className = "ai-th-label";
    labelSpan.textContent = labelText;

    const iconSpan = document.createElement("span");
    iconSpan.className = "ai-th-filter-trigger";
    iconSpan.title = t("admin.filterColumn");

    inner.appendChild(labelSpan);
    inner.appendChild(iconSpan);
    th.appendChild(inner);

    iconSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      openDropdownForTh(tableEl, th, index);
    });
    th.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.closest(".ai-th-filter-trigger")) return;
      e.stopPropagation();
      openDropdownForTh(tableEl, th, index);
    });
  });

  tableEl.dataset.aiFilterEnhanced = "1";
}

function getTableHeaderKey(tableEl: HTMLTableElement): string {
  const thead = tableEl.tHead;
  if (!thead || !thead.rows.length) return "";
  const ths = Array.from(thead.rows[0].cells);
  if (!ths.length) return "";
  const texts = ths.map((th) => (th.textContent || "").trim().replace(/\s+/g, " "));
  return `${ths.length}__${texts.join("||")}`;
}

function setupDetailsMergeForTables(
  rootEl: Element,
  enhanceAllTablesFn: (el: Element) => void
): void {
  const detailsList = Array.from(rootEl.querySelectorAll("details")) as HTMLDetailsElement[];

  detailsList.forEach((detailsEl) => {
    const htmlEl = detailsEl as HTMLElement & { _aiMergeBound?: boolean; _aiMerged?: boolean };
    if (htmlEl._aiMergeBound) return;
    htmlEl._aiMergeBound = true;

    const summaryEl = detailsEl.querySelector("summary");
    if (!summaryEl) return;

    const innerTable = detailsEl.querySelector("table");
    if (!innerTable) return;

    detailsEl.dataset.aiTableDetails = "1";
    if (!detailsEl.dataset.aiSummaryOriginal) {
      detailsEl.dataset.aiSummaryOriginal = summaryEl.textContent || "";
    }
    summaryEl.classList.add("ai-table-more-toggle");
    if (!(summaryEl as HTMLElement).dataset.aiState) {
      (summaryEl as HTMLElement).dataset.aiState = "collapsed";
    }

    summaryEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (htmlEl._aiMerged) return;

      let prev = detailsEl.previousElementSibling;
      let mainTable: HTMLTableElement | null = null;
      if (prev) {
        mainTable =
          prev.tagName === "TABLE" ? (prev as HTMLTableElement) : prev.querySelector("table");
      }
      if (!mainTable) {
        htmlEl._aiMerged = true;
        return;
      }

      const mainWrapper =
        mainTable.closest(".table-wrapper") ||
        mainTable.closest(".data-result-table-wrapper") ||
        mainTable;
      const blockParent = mainWrapper.parentNode;
      const anchorNext = detailsEl.nextSibling;

      const mainBody = mainTable.tBodies[0];
      const innerBody = innerTable.tBodies[0];
      if (!mainBody || !innerBody) {
        htmlEl._aiMerged = true;
        return;
      }

      const visibleCount = mainBody.rows.length;
      const extraRows = Array.from(innerBody.rows);
      if (!extraRows.length) {
        htmlEl._aiMerged = true;
        return;
      }

      tableCollapseMeta.set(mainTable, {
        visibleCount,
        totalCount: visibleCount + extraRows.length,
        detailsTemplate: detailsEl.cloneNode(true) as HTMLElement,
      });

      extraRows.forEach((tr) => mainBody.appendChild(tr));
      htmlEl._aiMerged = true;
      detailsEl.remove();

      const collapseTrigger = summaryEl.cloneNode(true) as HTMLElement;
      collapseTrigger.classList.add("ai-table-collapse-trigger", "ai-table-more-toggle");
      collapseTrigger.dataset.aiState = "expanded";
      collapseTrigger.textContent = t("example.collapseToRows", { n: visibleCount });

      if (blockParent) blockParent.insertBefore(collapseTrigger, anchorNext);
      collapseTrigger.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();

        const meta = tableCollapseMeta.get(mainTable!);
        if (!meta) {
          collapseTrigger.remove();
          return;
        }
        const tbody = mainTable!.tBodies[0];
        if (!tbody) {
          collapseTrigger.remove();
          return;
        }

        const allRows = Array.from(tbody.rows);
        for (let i = allRows.length - 1; i >= meta.visibleCount; i--) {
          allRows[i].parentNode?.removeChild(allRows[i]);
        }

        if (blockParent && meta.detailsTemplate) {
          const newDetails = meta.detailsTemplate.cloneNode(true) as HTMLElement;
          (newDetails as any)._aiMergeBound = false;
          (newDetails as any)._aiMerged = false;
          blockParent.insertBefore(newDetails, collapseTrigger.nextSibling);
        }
        collapseTrigger.remove();
        requestAnimationFrame(() => enhanceAllTablesFn(rootEl));
      });

      requestAnimationFrame(() => enhanceAllTablesFn(rootEl));
    });
  });
}

function enhanceTablesInList(tables: HTMLTableElement[]): void {
  if (!tables || !tables.length) return;

  const headerGroups = new Map<string, HTMLTableElement[]>();
  tables.forEach((tableEl) => {
    const key = getTableHeaderKey(tableEl);
    if (!key) return;
    if (!headerGroups.has(key)) headerGroups.set(key, []);
    headerGroups.get(key)!.push(tableEl);
  });

  headerGroups.forEach((group) => {
    const master = group[0];
    const oldMasterState = tableFilterCache.get(master);
    const sharedFilters = oldMasterState?.columnFilters ?? new Map();

    const masterState = collectTableData(master);
    if (!masterState) return;
    masterState.columnFilters = sharedFilters;
    tableFilterCache.set(master, masterState);

    group.forEach((t) => tableGroupMap.set(t, group));

    const mergedColumnValues = new Map(masterState.columnValues);
    const mergedValueCounts = new Map<number, Map<string, number>>();
    masterState.valueCounts.forEach((map, colIndex) => {
      mergedValueCounts.set(colIndex, new Map(map));
    });

    for (let i = 1; i < group.length; i++) {
      const t = group[i];
      const state = collectTableData(t);
      if (!state) continue;
      state.columnFilters = sharedFilters;
      tableFilterCache.set(t, state);

      state.columnValues.forEach((vals, colIndex) => {
        let list = mergedColumnValues.get(colIndex);
        if (!list) {
          list = [];
          mergedColumnValues.set(colIndex, list);
        }
        vals.forEach((v) => {
          if (v && !list!.includes(v)) list!.push(v);
        });
      });
      state.valueCounts.forEach((map, colIndex) => {
        let totalMap = mergedValueCounts.get(colIndex);
        if (!totalMap) {
          totalMap = new Map();
          mergedValueCounts.set(colIndex, totalMap);
        }
        map.forEach((count, val) => totalMap!.set(val, (totalMap!.get(val) || 0) + count));
      });
    }

    masterState.columnValues = mergedColumnValues;
    masterState.valueCounts = mergedValueCounts;
    tableFilterCache.set(master, masterState);

    enhanceTableWithHeaderFilter(master);
    group.forEach((t) => applyFiltersForTable(t));
  });
}

function enhanceAllTables(rootEl: Element): void {
  if (!rootEl) return;
  setupDetailsMergeForTables(rootEl, enhanceAllTables);

  const canEnhanceTable = (table: HTMLTableElement): boolean => {
    return !table.closest('[data-ai-table-enhancer="off"]');
  };

  const handled = new Set<HTMLTableElement>();
  const wrappers = Array.from(rootEl.querySelectorAll(".table-wrapper"));
  wrappers.forEach((wrapper) => {
    const innerTables = Array.from(wrapper.querySelectorAll("table")).filter(
      (t): t is HTMLTableElement =>
        t instanceof HTMLTableElement && !t.closest("details") && canEnhanceTable(t)
    );
    if (!innerTables.length) return;
    enhanceTablesInList(innerTables);
    innerTables.forEach((t) => handled.add(t));
  });

  const restTables = Array.from(rootEl.querySelectorAll("table")).filter(
    (t): t is HTMLTableElement =>
      t instanceof HTMLTableElement &&
      !t.closest("details") &&
      !handled.has(t) &&
      canEnhanceTable(t)
  );
  enhanceTablesInList(restTables);
}

export function setupAiTableEnhancer(rootSelectorOrEl: string | Element = ".chat-layout"): {
  dispose: () => void;
} {
  injectStyles();

  const rootEl =
    typeof rootSelectorOrEl === "string"
      ? document.querySelector(rootSelectorOrEl)
      : rootSelectorOrEl;

  if (!rootEl) return { dispose() {} };

  enhanceAllTables(rootEl);

  let observer: MutationObserver | null = new MutationObserver((mutations) => {
    let needEnhance = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        needEnhance = true;
        break;
      }
    }
    if (needEnhance) {
      requestAnimationFrame(() => enhanceAllTables(rootEl!));
    }
  });

  observer.observe(rootEl, { childList: true, subtree: true });

  return {
    dispose() {
      observer?.disconnect();
      observer = null;
      if (dropdownOutsideHandler) {
        window.removeEventListener("click", dropdownOutsideHandler);
        dropdownOutsideHandler = null;
      }
      dropdownEl?.parentNode?.removeChild(dropdownEl);
      dropdownEl = null;
      dropdownSearchInput = null;
      dropdownListEl = null;
      sortNameBtn = null;
      sortCountBtn = null;
      rowAscBtn = null;
      rowDescBtn = null;
      activeFilterTable = null;
      activeFilterColIndex = -1;
      dropdownCurrentOptions = [];
      dropdownCurrentSelected = new Set();
      dropdownValueCountMap = null;
      dropdownSortMode = "name-asc";
    },
  };
}
