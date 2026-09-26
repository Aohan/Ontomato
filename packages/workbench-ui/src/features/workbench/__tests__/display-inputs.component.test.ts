import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import WorkbenchWelcomeState from "../components/WorkbenchWelcomeState.vue";
import WorkbenchAgentRail from "../components/WorkbenchAgentRail.vue";
import { workbenchI18n } from "../../../i18n";
import type { WorkbenchAgent } from "../types";

const global = { plugins: [workbenchI18n(), createPinia(), ElementPlus] };

describe("两版布局给出的展示输入", () => {
  it("欢迎态按明确的动画类型渲染：企业视频、开源带 alt 的静态图标", () => {
    const video = mount(WorkbenchWelcomeState, {
      props: { mode: "qa", animation: { kind: "video", src: "/robot.webm" } },
      global,
    });
    const media = video.find(".empty-icon-large video");
    expect(media.attributes()).toMatchObject({ src: "/robot.webm", autoplay: "", loop: "", playsinline: "" });
    expect(video.find(".empty-icon-large").classes()).toContain("empty-icon-large--video");

    const image = mount(WorkbenchWelcomeState, {
      props: { mode: "qa", animation: { kind: "image", src: "/mark.svg", alt: "Ontomato" } },
      global,
    });
    expect(image.find(".empty-icon-large img").attributes()).toMatchObject({ src: "/mark.svg", alt: "Ontomato" });
    expect(image.find(".empty-icon-large").classes()).toContain("empty-icon-large--image");
  });

  const qaAgent = { id: "__qa__", name: "Q&A", description: "", icon: "{}", isQA: true } as WorkbenchAgent;
  const rail = (extra: Record<string, unknown>) =>
    mount(WorkbenchAgentRail, {
      props: {
        logoSrc: "/logo.svg",
        brandName: "Brand",
        brandSubtitle: "",
        addAgentLabel: "Add agent",
        qaAgent,
        agents: [],
        selectionMode: "qa",
        selectedAgentId: "",
        ...extra,
      },
      global,
    });

  it("入口栏不传输入时保持企业原样：卡片为带原生 title 的 div，新增按钮带 title、图标 16", () => {
    const wrapper = rail({});
    const card = wrapper.find(".agent-card");
    expect(card.element.tagName).toBe("DIV");
    expect(card.attributes("title")).toBe("Q&A");
    expect(card.classes()).not.toContain("agent-card--button");
    expect(wrapper.find(".agent-add-btn").attributes("title")).toBe("Add agent");
    expect(wrapper.find(".agent-add-btn svg").attributes("width")).toBe("16");
  });

  it("开源布局传入时：卡片为带 aria-label 的 button、无原生 title，新增图标 18", () => {
    const wrapper = rail({ compact: false, cardTag: "button", nativeTitles: false, addIconSize: 18 });
    const card = wrapper.find(".agent-card");
    expect(card.element.tagName).toBe("BUTTON");
    expect(card.attributes()).toMatchObject({ type: "button", "aria-label": "Q&A" });
    expect(card.attributes("title")).toBeUndefined();
    expect(wrapper.find(".agent-add-btn").attributes("title")).toBeUndefined();
    expect(wrapper.find(".agent-add-btn svg").attributes("width")).toBe("18");
  });
});
