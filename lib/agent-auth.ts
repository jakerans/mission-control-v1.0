// How agents sign in, set with AGENT_AUTH in .env:
// - "api_key" (default): ANTHROPIC_API_KEY, the method the Agent SDK docs say to use.
// - "claude_login": the Claude Code login on this PC (your Claude plan). Only switch to this once
//   you've confirmed with Anthropic that it's allowed for your use.
export function agentAuth() {
  return process.env.AGENT_AUTH === "claude_login" ? "claude_login" : "api_key";
}

export function authReady() {
  return agentAuth() === "claude_login" || Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
