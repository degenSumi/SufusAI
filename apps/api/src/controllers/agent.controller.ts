import type { AgentType } from "@repo/shared";
import { ALL_AGENTS, getAgentDefinition } from "../agents/registry.js";
import { describeModels } from "../agents/provider.js";

export const agentController = {
  /** The routable specialists, as the router itself sees them. */
  listAgents() {
    const { provider, models } = describeModels();
    return {
      agents: ALL_AGENTS.map((agent) => ({
        type: agent.type,
        name: agent.name,
        description: agent.description,
        handles: agent.handles,
        toolCount: agent.tools.length,
        accent: agent.accent,
      })),
      router: {
        description:
          "Parent agent. Classifies each incoming message against the conversation context and delegates to one specialist, falling back to Support when confidence is low.",
        model: models.router,
        provider,
      },
    };
  },

  getCapabilities(type: AgentType) {
    const agent = getAgentDefinition(type);
    return {
      type: agent.type,
      name: agent.name,
      description: agent.description,
      handles: agent.handles,
      capabilities: agent.capabilities,
      tools: agent.tools,
      model: describeModels().models.agent,
    };
  },
};
