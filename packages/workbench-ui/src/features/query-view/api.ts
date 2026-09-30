import { apiGet, apiPost } from "../../utils/api";

export const queryViewApi = {
  getMetas: () => apiPost("/admin/getMetas", {}),
  getWholeClassDataByPage: (payload: unknown) => apiPost("/data/getWholeClassDataByPage", payload),
  queryDistinctAttrValue: (payload: unknown) => apiPost("/data/queryDistinctAttrValue", payload),
  listBusinessExamples: () => apiPost("/bussinessexample/getall", {}),
  addBusinessExample: (payload: unknown) => apiPost("/bussinessexample/add", payload),
  editBusinessExample: (payload: unknown) => apiPost("/bussinessexample/edit", payload),
  deleteBusinessExample: (exampleID: string) => apiPost("/bussinessexample/del", { exampleID }),
  listQuestionSplitterExamples: () => apiPost("/bussinessexample/getall_question_spliter", {}),
  addQuestionSplitterExample: (payload: unknown) =>
    apiPost("/bussinessexample/add_question_spliter", payload),
  editQuestionSplitterExample: (payload: unknown) =>
    apiPost("/bussinessexample/edit_question_spliter", payload),
  deleteQuestionSplitterExample: (id: string) =>
    apiPost("/bussinessexample/del_question_spliter", { id }),
  getDslCookerExample: () => apiGet("/admin/getDslCookerExample"),
  saveDslCookerExample: (content: string) => apiPost("/admin/saveDslCookerExample", { content }),
  getQuestionSplitterExample: () => apiGet("/admin/getQuestionSpliterExample"),
  saveQuestionSplitterExample: (content: string) =>
    apiPost("/admin/saveQuestionSpliterExample", { content }),
};
