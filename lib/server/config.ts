export function aiKey() {
  return process.env.OPENAI_API_KEY || process.env.FIRSTPOINT_OPENAI_KEY;
}
export function aiConfigured() {
  return Boolean(aiKey());
}
