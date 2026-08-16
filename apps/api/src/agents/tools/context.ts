import { z } from "zod";

// userId is tool *context*, not tool *input*: injected server-side and absent
// from the schema the model sees, so it cannot ask for another customer's data.
export const toolContextSchema = z.object({
  userId: z.string().uuid(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;

// conversationId lets history search exclude the live thread.
export const supportToolContextSchema = toolContextSchema.extend({
  conversationId: z.string().uuid().optional(),
});

export type SupportToolContext = z.infer<typeof supportToolContextSchema>;

// Built from the agent's own tool names so a new tool cannot miss context.
export function buildToolsContext<T extends object>(
  toolNames: string[],
  context: T,
): Record<string, T> {
  return Object.fromEntries(toolNames.map((name) => [name, context]));
}
