// Stands in for axios in test-presentation.mjs: nothing under test makes a request.
export default { create: () => ({ interceptors: { request: { use() {} }, response: { use() {} } } }) };
