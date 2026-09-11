import { webSearchTool } from './webSearch'
import { generateImageTool } from './generateImage'
import type { ToolRegistry, ToolDef, ToolContext, ToolResult, ToolSettings } from './types'
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
export function buildToolDeclarations(): ToolDefinition[] {
  return Object.values(registry).map((tool) => tool.declaration)
}

/** Zwraca narzędzie po nazwie (funkcji tool call). */
export function getTool(name: string): ToolDef | undefined {
  return registry[name]
}

export type { ToolRegistry, ToolDef, ToolContext, ToolResult, ToolSettings }