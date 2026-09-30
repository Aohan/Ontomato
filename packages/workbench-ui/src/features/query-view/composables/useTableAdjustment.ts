import { type Ref, nextTick } from "vue";
import { useI18n } from "vue-i18n";

export function useTableAdjustment(contentRef: Ref<HTMLElement | null>) {
  const { t } = useI18n();
  let debounceTimer: number | null = null;
  let isAdjusting = false;

  const adjustTables = () => {
    if (!contentRef.value || isAdjusting) return;

    isAdjusting = true;

    requestAnimationFrame(() => {
      if (!contentRef.value) {
        isAdjusting = false;
        return;
      }

      const dataDetailsElements = contentRef.value.querySelectorAll(
        "details[data-ai-table-details]:not([data-ai-details-processed])"
      );

      if (dataDetailsElements.length === 0) {
        isAdjusting = false;
        return;
      }

      dataDetailsElements.forEach((details) => {
        details.setAttribute("data-ai-details-processed", "true");
        details.classList.add("table-details");

        const summary = details.querySelector("summary");
        if (summary) {
          summary.classList.add("ai-table-more-toggle");
          if (!summary.hasAttribute("data-ai-state")) {
            summary.setAttribute("data-ai-state", "collapsed");
          }
        }

        let prevElement = details.previousElementSibling;
        let prevTable: HTMLTableElement | null = null;

        while (prevElement) {
          if (prevElement.tagName === "TABLE") {
            prevTable = prevElement as HTMLTableElement;
            break;
          }
          if (prevElement.classList.contains("markdown-content")) {
            const tableInContent = prevElement.querySelector("table");
            if (tableInContent) {
              prevTable = tableInContent as HTMLTableElement;
              break;
            }
          }
          prevElement = prevElement.previousElementSibling;
        }

        if (prevTable && !prevTable.closest(".data-result-table-wrapper")) {
          if (!prevTable.hasAttribute("data-ai-table-processed")) {
            prevTable.setAttribute("data-ai-table-processed", "true");

            const wrapper = document.createElement("div");
            wrapper.className = "data-result-table-wrapper";
            wrapper.setAttribute("data-ai-wrapper-processed", "true");
            prevTable.parentNode?.insertBefore(wrapper, prevTable);
            wrapper.appendChild(prevTable);

            const detailsTable = details.querySelector("table");
            if (detailsTable) {
              const detailsWrapper = document.createElement("div");
              detailsWrapper.className = "data-result-table-wrapper";
              detailsTable.parentNode?.insertBefore(detailsWrapper, detailsTable);
              detailsWrapper.appendChild(detailsTable);
            }

            wrapper.parentNode?.insertBefore(details, wrapper.nextSibling);
          }
        }

        if (!details.hasAttribute("data-ai-listener-attached")) {
          details.addEventListener("toggle", handleDetailsToggle);
          details.setAttribute("data-ai-listener-attached", "true");
        }

        if ((details as HTMLDetailsElement).open) {
          mergeTablesInDetails(details as HTMLDetailsElement);
        }
      });

      const tables = contentRef.value.querySelectorAll("table");
      tables.forEach((table) => {
        const headerRow = table.querySelector("tr");
        if (!headerRow) return;

        const columns = headerRow.querySelectorAll("th").length;
        const isWrappedResultTable = Boolean(table.closest(".data-result-table-wrapper"));

        if (!isWrappedResultTable || columns <= 4) {
          table.style.width = "100%";

          const thead = table.querySelector("thead");
          const tbody = table.querySelector("tbody");
          if (thead) {
            thead.style.width = "100%";
          }
          if (tbody) {
            tbody.style.width = "100%";
          }
        }

        if (columns <= 4) {
          table.classList.add("table-fixed");
          const cells = table.querySelectorAll("th, td");
          cells.forEach((cell) => {
            cell.classList.add("cell-wrap");
          });
        }
      });

      isAdjusting = false;
    });
  };

  const handleDetailsToggle = (event: Event) => {
    const details = event.target as HTMLDetailsElement;
    if (details.open) {
      mergeTablesInDetails(details);
    }
  };

  const mergeTablesInDetails = (details: HTMLDetailsElement) => {
    if (details.hasAttribute("data-merged")) {
      return;
    }

    let prevElement = details.previousElementSibling;
    let prevTable: HTMLTableElement | null = null;

    while (prevElement) {
      if (prevElement.classList.contains("data-result-table-wrapper")) {
        prevTable = prevElement.querySelector("table");
        break;
      }
      if (prevElement.tagName === "TABLE") {
        prevTable = prevElement as HTMLTableElement;
        break;
      }
      if (prevElement.classList.contains("markdown-content")) {
        const tableInContent = prevElement.querySelector("table");
        if (tableInContent) {
          prevTable = tableInContent as HTMLTableElement;
          break;
        }
      }
      prevElement = prevElement.previousElementSibling;
    }

    const innerTable = details.querySelector("table");

    if (prevTable && innerTable) {
      const firstTbody = prevTable.querySelector("tbody");
      const secondTbody = innerTable.querySelector("tbody");

      if (firstTbody && secondTbody) {
        const visibleCount = firstTbody.children.length;
        const extraRows = Array.from(secondTbody.children);
        const totalCount = visibleCount + extraRows.length;

        details.setAttribute("data-saved-rows-count", String(extraRows.length));
        details.setAttribute("data-visible-count", String(visibleCount));
        details.setAttribute("data-total-count", String(totalCount));

        extraRows.forEach((tr) => {
          firstTbody.appendChild(tr);
        });

        details.setAttribute("data-merged", "true");

        const summary = details.querySelector("summary");
        if (summary) {
          const collapseTrigger = summary.cloneNode(true) as HTMLElement;
          collapseTrigger.classList.add("ai-table-more-toggle");
          collapseTrigger.setAttribute("data-ai-state", "expanded");
          collapseTrigger.textContent = t("table.collapseReturn", { n: visibleCount });

          details.insertAdjacentElement("afterend", collapseTrigger);
          collapseTrigger.addEventListener("click", handleCollapseClick);
        }

        details.style.display = "none";
      }
    }
  };

  const handleCollapseClick = (event: Event) => {
    const collapseTrigger = event.target as HTMLElement;

    let prevElement = collapseTrigger.previousElementSibling;
    let details: HTMLDetailsElement | null = null;

    while (prevElement) {
      if (prevElement.tagName === "DETAILS" && prevElement.hasAttribute("data-ai-table-details")) {
        details = prevElement as HTMLDetailsElement;
        break;
      }
      prevElement = prevElement.previousElementSibling;
    }

    if (!details) return;

    let mainTable: HTMLTableElement | null = null;
    let tableElement = details.previousElementSibling;
    while (tableElement) {
      if (tableElement.classList.contains("data-result-table-wrapper")) {
        mainTable = tableElement.querySelector("table");
        break;
      }
      if (tableElement.tagName === "TABLE") {
        mainTable = tableElement as HTMLTableElement;
        break;
      }
      if (tableElement.classList.contains("markdown-content")) {
        const tableInContent = tableElement.querySelector("table");
        if (tableInContent) {
          mainTable = tableInContent as HTMLTableElement;
          break;
        }
      }
      tableElement = tableElement.previousElementSibling;
    }

    if (!mainTable) return;

    const mainBody = mainTable.querySelector("tbody");
    if (!mainBody) return;

    const visibleCount = parseInt(details.getAttribute("data-visible-count") || "0");

    const innerTable = details.querySelector("table");
    const innerBody = innerTable?.querySelector("tbody");

    const allRows = Array.from(mainBody.children);
    if (allRows.length > visibleCount && innerBody) {
      for (let i = visibleCount; i < allRows.length; i++) {
        const row = allRows[i];
        if (row && row.parentNode) {
          innerBody.appendChild(row);
        }
      }
    }

    details.style.display = "";
    details.removeAttribute("data-merged");

    const summary = details.querySelector("summary");
    if (summary) {
      summary.setAttribute("data-ai-state", "collapsed");
    }

    collapseTrigger.remove();

    details.removeAttribute("open");
  };

  const initializeTableAdjustment = async (immediate: boolean = false) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (immediate) {
      await nextTick();
      adjustTables();
    } else {
      await nextTick();
      debounceTimer = window.setTimeout(() => {
        adjustTables();
        debounceTimer = null;
      }, 300);
    }
  };

  return {
    adjustTables,
    initializeTableAdjustment,
  };
}
