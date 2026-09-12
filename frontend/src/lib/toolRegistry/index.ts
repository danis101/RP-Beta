import { webSearchTool } from './webSearch'
import { generateImageTool } from './generateImage'
import type { ToolRegistry, ToolDef, ToolContext, ToolResult, ToolSettings, ToolAvailability } from './types'
import type { ToolDefinition } from '../../services/api'

/**
 * Rejestr wszystkich narzędzi dostępnych dla modelu (tool calling).
 * Aby dodać nowe narzędzie: zaimplementuj ToolDef i dodaj tutaj.
 */
export const registry: ToolRegistry = {
  [webSearchTool.name]: webSearchTool,
  [generateImageTool.name]: generateImageTool,
}

/** Lista deklaracji JSON Schema dla LLM (do pola `tools` w żądaniu). */
export function buildToolDeclarations(settings: ToolAvailability): ToolDefinition[] {
  return Object.values(registry)
    .filter((tool) => settings[tool.enabledSetting] === true)
    .map((tool) => tool.declaration)
}

/** Zwraca narzędzie po nazwie (funkcji tool call). */
export function getTool(name: string, settings: ToolAvailability): ToolDef | undefined {
  if (!Object.prototype.hasOwnProperty.call(registry, name)) return undefined
  const tool = registry[name]
  return settings[tool.enabledSetting] === true ? tool : undefined
}

export type { ToolRegistry, ToolDef, ToolContext, ToolResult, ToolSettings }
