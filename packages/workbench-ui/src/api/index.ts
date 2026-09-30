import {
  nodeApiGet,
  nodeApiPost,
  nodeApiPut,
  nodeApiDelete,
  nodeApiPatch,
  nodeApiPostFormData,
  nodeApiBlobPost,
  nodeApiFetch,
} from "../utils/api";

export const api = {
  get: nodeApiGet,
  post: nodeApiPost,
  put: nodeApiPut,
  delete: nodeApiDelete,
  patch: nodeApiPatch,
  postFormData: nodeApiPostFormData,
  blobPost: nodeApiBlobPost,
  fetch: nodeApiFetch,
};

export {
  nodeApiGet,
  nodeApiPost,
  nodeApiPut,
  nodeApiDelete,
  nodeApiPatch,
  nodeApiPostFormData,
  nodeApiBlobPost,
  nodeApiFetch,
};

export default api;
