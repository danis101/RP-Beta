import type { ToolDef } from './types'
import { refineImagePrompt } from '../refiner'
import { generateImage } from '../imageGen'
import { uploadBlobFromBlob } from '../../services/sync'

/**
 * Narzedzie generate_image - model czatu prosi o obraz.
 * Przeplyw: kontekst (karta postaci + ostatnie wiadomosci) -> refiner (osobny LLM)
 *          -> czysty positive prompt -> mostek ComfyUI -> blob na /blobs.
 *
 * `prompt` zapisujemy w toolCall, zeby mozna bylo zregenerowac obraz
 * bez wywolywania LLM ponownie.
 *
 * `ctx.imageStyleDirective` (opcjonalne) — wymuszony styl wybrany przez
 * usera w menu konwersacji. Przekazywany do refinera.
 */
export const generateImageTool: ToolDef = {
  name: 'generate_image',
  declaration: {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image of the current scene or character described in the conversation. Use this when the story calls for a visual of what is happening or how the character currently looks.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'Short description of what should be depicted: the character, their current outfit/pose, and the scene. Be concrete.',
          },
        },
        required: ['description'],
      },
    },
  },
  async run(args, _call, ctx) {
    const description = typeof args.description === 'string' ? args.description : ''
    const baseUrl = ctx.settings.imageGenBaseUrl as string | undefined
    const responseFormat = (ctx.settings.imageGenResponseFormat as 'url' | 'b64_json' | undefined) ?? 'url'
    const refinerPrompt = (ctx.settings.imageGenRefinerPrompt as string | undefined) ?? ''
    const contextMessages = (ctx.settings.imageGenContextMessages as number | undefined) ?? 6

    if (!baseUrl) {
      return {
        toolCall: {
          type: 'image',
          label: description || 'Generowanie obrazu',
          status: 'error',
          error: 'Nie ustawiono adresu backendu generowania obrazow.',
        },
      }
    }

    if (!ctx.refinerAdapter) {
      return {
        toolCall: {
          type: 'image',
          label: description || 'Generowanie obrazu',
          status: 'error',
          error: 'Brak modelu refinera. Skonfiguruj profil API.',
        },
      }
    }

    try {
      const prompt = await refineImagePrompt(
        {
          character: ctx.character,
          persona: ctx.persona,
          history: ctx.history,
          contextMessages,
          imageStyleDirective: ctx.imageStyleDirective,
        },
        refinerPrompt,
        ctx.refinerAdapter,
        ctx.refinerModel,
      )

      const result = await generateImage(prompt, { baseUrl, responseFormat })

      if (result.status === 'done') {
        const blobId = await uploadBlobFromBlob(result.blob, 'generated.png')
        return {
          toolCall: {
            type: 'image',
            label: description || 'Wygenerowany obraz',
            imageBlobId: blobId,
            status: 'done',
            prompt,
          },
        }
      }
      if (result.status === 'processing') {
        return {
          toolCall: {
            type: 'image',
            label: description || 'Generowanie obrazu',
            status: 'generating',
            error: 'Generowanie trwa dluzej niz 45s. Obraz pojawi sie wkrotce.',
            prompt,
          },
        }
      }
      return {
        toolCall: {
          type: 'image',
          label: description || 'Generowanie obrazu',
          status: 'error',
          error: result.message,
          prompt,
        },
      }
    } catch (error) {
      return {
        toolCall: {
          type: 'image',
          label: description || 'Generowanie obrazu',
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
}

// === END OF FILE ===

