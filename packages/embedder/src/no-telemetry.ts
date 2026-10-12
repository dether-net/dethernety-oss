/**
 * onnxruntime's official Linux and macOS builds upload usage telemetry by default (process, model and
 * session events, a hashed device id) and keep an event cache and the device id under the user's cache
 * directory. Embedding runs on the operator's machine and must send nothing, so the opt-out is set before
 * onnxruntime loads. onnxruntime reads it once at initialisation and then suppresses telemetry for the
 * whole process: no uploader, no events, no device id. It is set unconditionally, overriding any
 * value the environment carries.
 */
process.env.ORT_DISABLE_TELEMETRY = '1';

export {};
